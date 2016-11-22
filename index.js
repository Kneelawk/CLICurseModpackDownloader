'use strict';

// builtin modules
const fs = require('fs');
const path = require('path');
const Callback = require('events');
// extra modules
const minimist = require('minimist');
const unzip = require('unzip');
const prompt = require('prompt');
const mkdirp = require('mkdirp');
const ProgressBar = require('progress');
// my modules
const downloader = require('./downloader.js');
const Curse = require('./curse.js').Curse;
const curseMods = require('./curseMods.js');

// constants
const overridesLen = 'overrides/'.length;

let args = minimist(process.argv.slice(2));

let outputDir = process.cwd();
if (args.d) {
  outputDir = args.d;
}

let modpack;
if (args.f) {
  modpack = fs.createReadStream(args.f);
} else {
  modpack = process.stdin;
}

if (!args.f && (!args.username || !args.password)) {
  console.error('A username and password are required when reading modpack from stdin.');
  process.exit(1);
}

let username;
if (args.username) {
  username = args.username;
}

let password;
if (args.password) {
  password = args.password;
}

let percentUpdate;
if (args.['percent-update']) {
  percentUpdate = args.['percent-update'];
  if (isNaN(parseFloat(percentUpdate)) || !isFinite(percentUpdate)) {
    console.error('percent-update must be a number.');
    process.exit(1);
  }
}

let progressBar;
if (args.progress) {
  progressBar = args.progress;
}

let retries = 10;
if (args.retries) {
  retries = args.retries;
}

let logRetries = false;
if (args['log-retries']) {
  logRetries = true;
}

function getStringFromStream(stream) {
  let callback = new Callback();

  let str = '';

  stream.on('data', (chunk) => {
    str += chunk;
  }).on('end', () => {
    callback.emit('finish', str);
  });

  return callback;
}

let completedMods = 0;

function downloadMod(outputDir, url, disabled, numOfMods, percentUpdate, modsProgressBar, retries, logRetries) {
  let filename = downloader.getFileName(url) + (disabled ? '.disabled' : '');
  let outputPath = path.join(outputDir, 'mods', filename);

  let out = fs.createWriteStream(outputPath);

  let download = downloader.downloadWithRetries(url, out, retries);

  if (typeof(percentUpdate) == 'number' && percentUpdate > 0) {
    let lastLoggedProgress = 0;
    download.on('progress', (progress) => {
      if (progress.outOf > 0) {
        let percent = Math.floor(progress.progress * 100 / progress.outOf);
        if (Math.floor(percent / percentUpdate) > Math.floor(lastLoggedProgress / percentUpdate)) {
          console.log(percent + '%: ' + filename);
        }
        lastLoggedProgress = percent;
      } else {
        if (Math.floor(progress.progress / percentUpdate) > Math.floor(lastLoggedProgress / percentUpdate)) {
          console.log(Math.floor(progress.progress / 1024) + 'KiB: ' + filename);
        }
        lastLoggedProgress = progress.progress;
      }
    });
  }

  download.on('error', (error) => {
    console.log('Download error:');
    console.log(error);
  }).on('retry', (retry) => {
    if (logRetries) {
      console.log('Retrying ' + filename);
    }
  }).on('finish', () => {
    // nodejs runs on a single thread
    completedMods++;

    if (modsProgressBar == 'log') {
      console.log('Completed download: ' + filename);
      console.log('Completed: ' + completedMods + ' / ' + numOfMods + ' (' + Math.floor(completedMods * 100 / numOfMods) + '%)');
    } else if (modsProgressBar) {
      modsProgressBar.tick();
    }

    out.end();
  });
}

prompt.override = {
  username,
  password
};

prompt.message = 'Login';
prompt.get([{
  name: 'username',
  required: true
}, {
  name: 'password',
  hidden: true,
  required: true
}], (err, result) => {
  if (err) {
    console.log(err);
    process.exit(1);
  }

  let username = result.username;
  let password = result.password;

  let c = new Curse();

  c.login(username, password).on('login', (login) => {
    console.log('Logged in as: ' + login.username);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    modpack.pipe(unzip.Parse()).on('entry', (entry) => {
      if (entry.path == 'manifest.json') {
        getStringFromStream(entry).on('finish', (str) => {
          let manifest = JSON.parse(str);

          console.log('');
          console.log('Modpack: ' + manifest.name);
          console.log('Modpack version: ' + manifest.version);
          console.log('Modpack author: ' + manifest.author);
          console.log('Minecraft version: ' + manifest.minecraft.version);
          console.log('');

          let modLoaders = manifest.minecraft.modLoaders;
          console.log('Modloaders:');
          modLoaders.forEach((element) => {
            console.log(element.id + (element.primary ? ' - primary' : ''));
          });
          console.log('');

          if (!fs.existsSync(path.join(outputDir, 'mods'))) {
            mkdirp.sync(path.join(outputDir, 'mods'));
          }

          let files = manifest.files;
          console.log('Downloading ' + files.length + ' files...');

          if (progressBar == 'bar') {
            progressBar = new ProgressBar('Downloading [:bar] :percent (:current / :total)', {
              total: files.length,
              width: 100
            });
          }

          files.forEach((element) => {
            curseMods.getFileDownloadUrl(c, element.projectID, element.fileID).on('finish', (url) => {
              downloadMod(outputDir, url, element.required == false, files.length, percentUpdate, progressBar, retries, logRetries);
            }).on('error', (error) => {
              if (error.type == 'bad response code') {
                if (error.response.statusCode == 404) {
                  curseMods.getLatestDownloadUrl(c, element.projectID, manifest.minecraft.version).on('finish', (url) => {
                    downloadMod(outputDir, url, element.required == false, files.length, percentUpdate, progressBar, retries, logRetries);
                  }).on('error', (error) => {
                    console.log(error);
                  });
                }
              }
            });
          });
        });

        entry.pipe(fs.createWriteStream(path.join(outputDir, 'manifest.json')));
      } else if (entry.path.startsWith('overrides/') && entry.type == 'File') {
        let outPath = entry.path.slice(overridesLen);
        if (args.logoverrides) {
          console.log('Extracting override: ' + outPath);
        }
        if (!fs.existsSync(path.join(outputDir, outPath, '..'))) {
          mkdirp.sync(path.join(outputDir, outPath, '..'));
        }
        entry.pipe(fs.createWriteStream(path.join(outputDir, outPath)));
      }
    });
  }).on('error', (error) => {
    if (error.type == 'bad response code' && error.response.statusCode == 401) {
      console.log('Invalid username or password');
    } else {
      console.log(error);
    }
    process.exit(1);
  });
});
