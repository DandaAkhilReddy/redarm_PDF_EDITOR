const { app } = require("@azure/functions");

app.setup({
  enableHttpStream: false
});

require("./functions/authLogin");
require("./functions/docsUploadUrl");
require("./functions/docsSaveAnnotation");
require("./functions/docsExportStart");
require("./functions/docsOcrStart");
require("./functions/jobsGet");
require("./functions/exportWorker");
require("./functions/ocrWorker");