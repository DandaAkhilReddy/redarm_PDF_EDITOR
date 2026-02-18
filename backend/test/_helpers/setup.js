// backend/test/_helpers/setup.js
// MUST be loaded before any source module that imports config.js
// config.js calls required("STORAGE_CONNECTION_STRING") at module load time,
// which throws if the env var is missing. Set all env vars here first.

process.env.STORAGE_CONNECTION_STRING = 'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;TableEndpoint=http://127.0.0.1:10002/devstoreaccount1';
process.env.JWT_SECRET = 'test-jwt-secret-key-that-is-at-least-32-characters-long-for-testing';
process.env.BOOTSTRAP_ADMIN_EMAIL = 'admin@test.redarm';
process.env.BOOTSTRAP_ADMIN_PASSWORD = 'TestPassword123!';
process.env.STORAGE_ACCOUNT_NAME = 'devstoreaccount1';
process.env.STORAGE_ACCOUNT_KEY = 'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';
process.env.FUNCTIONS_WORKER_RUNTIME = 'node';
process.env.TABLE_USERS = 'users';
process.env.TABLE_DOCUMENTS = 'documents';
process.env.TABLE_SESSIONS = 'sessions';
process.env.TABLE_JOBS = 'jobs';
process.env.BLOB_SOURCE_CONTAINER = 'pdf-source';
process.env.BLOB_EXPORT_CONTAINER = 'pdf-export';
process.env.BLOB_OCR_CONTAINER = 'ocr-json';
process.env.QUEUE_OCR = 'q-ocr';
process.env.QUEUE_EXPORT = 'q-export';
process.env.JWT_EXPIRES_IN = '8h';
process.env.BCRYPT_ROUNDS = '4'; // Low rounds for fast tests
process.env.LOCKOUT_THRESHOLD = '5';
process.env.LOCKOUT_MINUTES = '15';
process.env.MAX_UPLOAD_BYTES = '10485760';
