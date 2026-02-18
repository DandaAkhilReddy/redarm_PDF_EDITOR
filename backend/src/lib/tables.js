const { TableClient } = require("@azure/data-tables");
const { config } = require("./config");

const clientCache = new Map();
const initCache = new Set();

function getTableClient(tableName) {
  if (!clientCache.has(tableName)) {
    clientCache.set(tableName, TableClient.fromConnectionString(config.storageConnectionString, tableName));
  }
  return clientCache.get(tableName);
}

async function ensureTable(tableName) {
  if (initCache.has(tableName)) {
    return;
  }
  const client = getTableClient(tableName);
  try {
    await client.createTable();
  } catch (err) {
    if (err.statusCode !== 409) {
      throw err;
    }
  }
  initCache.add(tableName);
}

async function getEntityOrNull(client, partitionKey, rowKey) {
  try {
    return await client.getEntity(partitionKey, rowKey);
  } catch (err) {
    if (err.statusCode === 404) {
      return null;
    }
    throw err;
  }
}

function isoNow() {
  return new Date().toISOString();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function getUser(email) {
  await ensureTable(config.usersTable);
  const client = getTableClient(config.usersTable);
  return getEntityOrNull(client, "USER", normalizeEmail(email));
}

async function upsertUser(entity) {
  await ensureTable(config.usersTable);
  const client = getTableClient(config.usersTable);
  await client.upsertEntity(
    {
      partitionKey: "USER",
      rowKey: normalizeEmail(entity.email),
      ...entity
    },
    "Merge"
  );
}

async function getDocument(docId) {
  await ensureTable(config.documentsTable);
  const client = getTableClient(config.documentsTable);
  return getEntityOrNull(client, "DOC", String(docId));
}

async function upsertDocument(entity) {
  await ensureTable(config.documentsTable);
  const client = getTableClient(config.documentsTable);
  await client.upsertEntity(
    {
      partitionKey: "DOC",
      rowKey: String(entity.docId),
      ...entity
    },
    "Merge"
  );
}

async function createJob(job) {
  await ensureTable(config.jobsTable);
  const client = getTableClient(config.jobsTable);
  await client.createEntity({
    partitionKey: "JOB",
    rowKey: job.jobId,
    ...job
  });
}

async function getJob(jobId) {
  await ensureTable(config.jobsTable);
  const client = getTableClient(config.jobsTable);
  return getEntityOrNull(client, "JOB", String(jobId));
}

async function updateJob(jobId, patch) {
  await ensureTable(config.jobsTable);
  const client = getTableClient(config.jobsTable);
  await client.upsertEntity(
    {
      partitionKey: "JOB",
      rowKey: String(jobId),
      ...patch
    },
    "Merge"
  );
}

module.exports = {
  isoNow,
  normalizeEmail,
  getUser,
  upsertUser,
  getDocument,
  upsertDocument,
  createJob,
  getJob,
  updateJob,
  ensureTable,
  getTableClient
};
