const request = require('request');
const Callback = require('events');

class DownloadCallback extends Callback {}

/*
 * Downloads a file from url to out.
 * ulr: Url to download from.
 * out: WriteStream to be written to.
 */
function download(url, out) {
  let size = 0;
  let downloaded = 0;

  let callback = new DownloadCallback();

  request(url).on('response', (response) => {
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
  }).on('end', () => {
    callback.emit('end');
  }).on('error', (error) => {
    callback.emit('error', error);
  });

  return callback;
}

function getFileName(url) {
  return url.slice(url.lastIndexOf('/') + 1);
}

module.exports = {
  download,
  getFileName
};
