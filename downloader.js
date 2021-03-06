const request = require('request');
const Callback = require('events');
const fs = require('fs');

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

class DownloadWithRetries extends Callback {
  constructor(url, path, maxRetries) {
    super();
    this.url = url;
    this.path = path;
    this.maxRetries = maxRetries;
    this.retries = 0;
    this.downloading = false;
    this.retrying = false;
  }

  start() {
    this.stream = fs.createWriteStream(this.path);
    this.req = download(this.url, this.stream);
    this.req.on('progress', (progress) => this._progressCallback(progress));
    this.req.on('finish', () => this._finishCallback());
    this.req.on('error', (error) => this._errorCallback(error));
    this.req.on('abort', () => this._abortCallback());
    this.downloading = true;
  }

  _progressCallback(progress) {
    this.emit('progress', progress);
  }

  _finishCallback() {
    this.downloading = false;
    if (this.stream) {
      this.stream.end();
    }
    this.emit('finish');
  }

  _errorCallback(error) {
    this.downloading = false;
    if (this.stream) {
      this.stream.end();
    }
    if (error.type = 'bad response code') {
      this.emit('error', error);
    } else if (retries < maxRetries) {
      retries++;
      this.start();
      this.emit('retry', {
        type: 'error retry',
        error,
        numRetries: retries,
        maxRetries
      })
    } else {
      this.emit('error', error);
    }
  }

  _abortCallback() {
    this.downloading = false;
    if (this.stream) {
      this.stream.end();
    }
    if (this.retrying) {
      this.retrying = false;
      this.retries = 0;
      this.start();
      this.emit('retry', {
        type: 'forced retry'
      });
    } else {
      this.emit('abort');
    }
  }

  abort() {
    if (this.downloading) {
      this.req.abort();
    }
  }

  retry() {
    if (this.downloading) {
      this.retrying = true;
      this.req.abort();
    }
  }
}

function downloadWithRetries(url, out, maxRetries) {
  let callback = new DownloadWithRetries(url, out, maxRetries);

  callback.start();

  return callback;
}

function getFileName(url) {
  return url.slice(url.lastIndexOf('/') + 1);
}

module.exports = {
  download,
  getFileName,
  downloadWithRetries
};
