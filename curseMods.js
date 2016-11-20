// curseMods.js - util methods for finding download urls for projectIds and fileIds

const Callback = require('events');

class GetInfoCallback extends Callback {}

const curseMods = {
  getFileDownloadUrl(curse, projectId, fileId) {
    let callback = new GetInfoCallback();

    curse.getFile(projectId, fileId).on('finish', (data) => {
      callback.emit('finish', data.download_url);
    }).on('error', (error) => {
      callback.emit('error', error);
    });

    return callback;
  },

  getLatestFile(curse, projectId, minecraftVersion) {
    let callback = new GetInfoCallback();

    curse.getProjectFiles(projectId).on('finish', (data) => {
      let files = data.files;

      if (files.length < 1) {
        callback.emit('error', {
          type: 'no files',
          message: ('Project #' + projectId + ' does not have any files.')
        });
        return;
      }

      let candidate = null;
      for (let i = 0; i < files.length; i++) {
        let file = files[i];
        if (file.game_version.includes(minecraftVersion)) {
          if (candidate == null) {
            candidate = file;
          } else if (new Date(file.file_date) > new Date(candidate.file_date)) {
            candidate = file;
          }
        }
      }

      if (candidate == null) {
        callback.emit('error', {
          type: 'no files for minecraft version',
          message: ('Project #' + projectId + ' does not have any files for minecraft version ' + minecraftVersion)
        });
        return;
      }

      callback.emit('finish', candidate);
    }).on('error', (error) => {
      callback.emit('error', error);
    });

    return callback;
  },

  getLatestDownloadUrl(curse, projectId, minecraftVersion) {
    let callback = new GetInfoCallback();

    curseMods.getLatestFile(curse, projectId, minecraftVersion).on('finish', (file) => {
      callback.emit('finish', file.download_url);
    }).on('error', (error) => {
      callback.emit('error', error);
    });

    return callback;
  }
};

module.exports = curseMods;
