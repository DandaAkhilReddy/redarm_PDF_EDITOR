const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  BlobSASPermissions,
  generateBlobSASQueryParameters
} = require("@azure/storage-blob");
const { QueueServiceClient } = require("@azure/storage-queue");
const { config } = require("./config");

const blobServiceClient = BlobServiceClient.fromConnectionString(config.storageConnectionString);

function getSharedCredential() {
  if (!config.storageAccountName || !config.storageAccountKey) {
    throw new Error("STORAGE_ACCOUNT_NAME and STORAGE_ACCOUNT_KEY are required for SAS generation");
  }
  return new StorageSharedKeyCredential(config.storageAccountName, config.storageAccountKey);
}

function getBlobClient(containerName, blobName) {
  return blobServiceClient.getContainerClient(containerName).getBlockBlobClient(blobName);
}

async function ensureContainer(containerName) {
  const client = blobServiceClient.getContainerClient(containerName);
  await client.createIfNotExists();
}

function buildBlobSasUrl(containerName, blobName, permissions, expiresInMinutes = 30) {
  const shared = getSharedCredential();
  const expiresOn = new Date(Date.now() + expiresInMinutes * 60 * 1000);
  const token = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse(permissions),
      expiresOn
    },
    shared
  ).toString();

  const isLocalDev = config.storageConnectionString.includes("UseDevelopmentStorage=true")
    || config.storageConnectionString.includes("127.0.0.1");

  let baseUrl;
  if (isLocalDev) {
    baseUrl = `http://127.0.0.1:10000/${config.storageAccountName}/${containerName}/${blobName}`;
  } else {
    baseUrl = `https://${config.storageAccountName}.blob.core.windows.net/${containerName}/${blobName}`;
  }

  return {
    url: `${baseUrl}?${token}`,
    expiresOn: expiresOn.toISOString()
  };
}

async function uploadJson(containerName, blobName, value) {
  await ensureContainer(containerName);
  const client = getBlobClient(containerName, blobName);
  const body = JSON.stringify(value, null, 2);
  await client.upload(body, Buffer.byteLength(body), {
    blobHTTPHeaders: {
      blobContentType: "application/json"
    }
  });
}

async function downloadToBuffer(containerName, blobName) {
  const client = getBlobClient(containerName, blobName);
  const response = await client.download();
  const chunks = [];
  for await (const chunk of response.readableStreamBody) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function uploadBuffer(containerName, blobName, buffer, contentType = "application/octet-stream") {
  await ensureContainer(containerName);
  const client = getBlobClient(containerName, blobName);
  await client.uploadData(buffer, {
    blobHTTPHeaders: {
      blobContentType: contentType
    }
  });
}

function getQueueClient(queueName) {
  const queueService = QueueServiceClient.fromConnectionString(config.storageConnectionString);
  return queueService.getQueueClient(queueName);
}

async function sendQueueMessage(queueName, value) {
  const queue = getQueueClient(queueName);
  await queue.createIfNotExists();
  // Azure Functions queue triggers decode base64 by default, so encode payloads explicitly.
  const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64");
  await queue.sendMessage(payload);
}

module.exports = {
  ensureContainer,
  buildBlobSasUrl,
  uploadJson,
  downloadToBuffer,
  uploadBuffer,
  sendQueueMessage
};
