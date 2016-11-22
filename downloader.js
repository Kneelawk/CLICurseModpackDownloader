const request = require('request');
const Callback = require('events');

class DownloadCallback extends Callback {}

/*
 * Downloads a file from url to out.
 * url: Url to download from.
 * out: WriteStream to be written to.
 */
function download(url, out) {
  let size = 0;
  let downloaded = 0;

  let callback = new DownloadCallback();

  let errorState = false;

  let req = request(url);
  req.on('response', (response) => {
    if (Math.floor(response.statusCode / 100) == 2) {
      if (response.headers['content-length']) {
        size = response.headers['content-length'];
      }
      callback.emit('response', response);
    } else {
      callback.emit('error', {
        type: 'bad response code',
        response
      });
    }
  }).on('data', (chunk) => {
    downloaded += chunk.length;
    callback.emit('progress', {
      progress: downloaded,
      outOf: size
    });
  }).on('error', (error) => {
    errorState = true;
    callback.emit('error', error);
  }).on('end', () => {
    if (!errorState) {
      // finish implies success
      callback.emit('finish');
    }
  }).on('abort', () => {
    callback.emit('abort');
  }).pipe(out);

  callback.abort = () => {
    req.abort();
  };

  return callback;
}

function downloadWithRetriesImpl(url, out, maxRetries, numRetries) {
  let callback = new DownloadCallback();

  let req = download(url, out);
  req.on('progress', (progress) => {
    callback.emit('progress', progress);
  }).on('finish', () => {
    callback.emit('finish');
  }).on('error', (error) => {
    if (error.type == 'bad response code') {
      callback.emit('error', error);
    } else if (numRetries < maxRetries) {
      let retryReq = downloadWithRetriesImpl(url, out, maxRetries, numRetries + 1);
      retryReq.on('progress', (progress) => {
        callback.emit('progress', progress);
      }).on('finish', () => {
        callback.emit('finish');
      }).on('retry', (retry) => {
        callback.emit('retry', retry);
      }).on('error', (error) => {
        callback.emit('error', error);
      });
      callback.emit('retry', {
        error,
        numRetries
      });
    } else {
      callback.emit('error', error);
    }
  }).on('abort', () => {

  });

  callback.retry = () => {
    callback._retrying = true;
    // TODO Finish retry and abort systems.
  };

  callback.abort = () => {

  };

  return callback;
}

function getFileName(url) {
  return url.slice(url.lastIndexOf('/') + 1);
}

module.exports = {
  download,
  getFileName,
  downloadWithRetries: function(url, out, maxRetries) {
    return downloadWithRetriesImpl(url, out, maxRetries, 0);
  }
};
