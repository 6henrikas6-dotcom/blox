import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';

// Repair migration history only for schema objects that already exist.
// Never create, drop, or alter application tables here.
const prisma = new PrismaClient();
const migrations = {
  community: '20261114160000_community_automation',
  tickets: '20261114163000_ticket_forms',
};
const requiredColumns = {
  CommunityAutomation: {
    guildId: 'text', welcomeChannelId: 'text', goodbyeChannelId: 'text',
    inviteLogChannelId: 'text', levelChannelId: 'text', welcomeMessage: 'text',
    goodbyeMessage: 'text', levelMessage: 'text', xpEnabled: 'boolean',
    xpPerMessage: 'integer', xpCooldownSeconds: 'integer',
    levelUpEnabled: 'boolean', inviteTrackingEnabled: 'boolean',
    updatedAt: 'timestamp without time zone',
  },
  MemberInvite: {
    guildId: 'text', userId: 'text', inviterId: 'text',
    inviteCode: 'text', joinedAt: 'timestamp without time zone',
  },
};
function assertColumns(rows, tableName, expected) {
  const found = new Map(rows.filter(row => row.table_name === tableName)
    .map(row => [row.column_name, row]));
  for (const [column, type] of Object.entries(expected)) {
    const actual = found.get(column);
    if (!actual || actual.data_type !== type) {
      throw new Error('Unsafe to resolve migrations: ' + tableName + '.' + column + ' missing or wrong type');
    }
  }
}
function assertIndex(indexes, tableName, indexName, columns) {
  const index = indexes.find(item => item.tablename === tableName && item.indexname === indexName);
  if (!index || !columns.every(column => index.indexdef.includes('"' + column + '"'))) {
    throw new Error('Unsafe to resolve migrations: expected index ' + indexName + ' missing or different');
  }
}
function markApplied(name) {
  console.log('Verified existing schema for ' + name + '; reconciling migration history.');
  execFileSync('./node_modules/.bin/prisma', ['migrate', 'resolve', '--applied', name], { stdio: 'inherit' });
}
try {
  // The digital order migration may have been interrupted after creating some tables.
  // Never drop tables or files: retry its now-idempotent SQL after resolving only a failed entry.
  const failedOrderRows = await prisma.$queryRaw`
    SELECT migration_name, finished_at, rolled_back_at, logs
    FROM "_prisma_migrations"
    WHERE migration_name = '20261120183000_digital_orders'
    ORDER BY started_at DESC
  `;
  const orderAlreadyApplied = failedOrderRows.some(row => row.finished_at !== null && row.rolled_back_at === null);
  const latestFailure = failedOrderRows.find(row => row.finished_at === null && row.rolled_back_at === null);
  if (!orderAlreadyApplied && latestFailure) {
    console.log('Digital order migration was interrupted. Reconciling failed migration record, then retrying non-destructive SQL.');
    console.log('Previous database migration error: '+String(latestFailure.logs??'').slice(0,1100));
    execFileSync('./node_modules/.bin/prisma', ['migrate','resolve','--rolled-back','20261120183000_digital_orders'], {stdio:'inherit'});
  }
  const rows = await prisma.$queryRaw`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('CommunityAutomation', 'MemberInvite', 'CommunityPanel')
  `;
  const indexes = await prisma.$queryRaw`
    SELECT tablename, indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename IN ('CommunityAutomation', 'MemberInvite')
  `;
  const history = await prisma.$queryRaw`
    SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"
    WHERE migration_name IN ('20261114160000_community_automation', '20261114163000_ticket_forms')
  `;
  const alreadyApplied = name => history.some(row =>
    row.migration_name === name && row.finished_at !== null && row.rolled_back_at === null);
  const tablesPresent = ['CommunityAutomation','MemberInvite'].every(name =>
    rows.some(row => row.table_name === name));
  if (!alreadyApplied(migrations.community) && tablesPresent) {
    for (const [name, expected] of Object.entries(requiredColumns)) assertColumns(rows,name,expected);
    assertIndex(indexes,'CommunityAutomation','CommunityAutomation_pkey',['guildId']);
    assertIndex(indexes,'MemberInvite','MemberInvite_pkey',['guildId','userId']);
    assertIndex(indexes,'MemberInvite','MemberInvite_guildId_inviterId_idx',['guildId','inviterId']);
    markApplied(migrations.community);
  } else if (!tablesPresent) {
    console.log('Community tables are incomplete; leaving their migration to Prisma migrate deploy.');
  }
  const ticketColumn = rows.find(row => row.table_name === 'CommunityPanel' && row.column_name === 'ticketOptionsJson');
  if (!alreadyApplied(migrations.tickets) && ticketColumn) {
    if (ticketColumn.data_type !== 'text') throw new Error('Unexpected ticketOptionsJson type');
    markApplied(migrations.tickets);
  }
} finally {
  await prisma.$disconnect();
}
