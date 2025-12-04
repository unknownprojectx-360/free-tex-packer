const fs = require('fs');
const path = require('path');
const {ipcRenderer} = require('electron');

import I18 from '../../utils/I18';

class Downloader {

    static run(files, fileName, savePath) {
        return new Promise((resolve, reject) => {
            let dir = savePath;

            if(!dir) {
                // Request directory selection from main process
                ipcRenderer.invoke('show-open-dialog', {
                    properties: ['openDirectory']
                }).then(result => {
                    if (!result.canceled) {
                        dir = result.filePaths[0];
                        processDirectory(dir);
                    } else {
                        resolve(); // User cancelled
                    }
                }).catch(err => {
                    console.error('Error selecting directory:', err);
                    reject(err);
                });
            } else {
                processDirectory(dir);
            }

            function processDirectory(dir) {
                let complete = () => {
                    try {
                        for(let file of files) {
                            let content = file.content;
                            if(file.base64) content = Buffer.from(content, 'base64');

                            let savePath = path.normalize(dir + "/" + file.name);
                            savePath = savePath.split("\\").join("/");

                            let saveDirParts = savePath.split("/");
                            saveDirParts.pop();
                            let currentPath = '';
                            while(saveDirParts.length) {
                                currentPath = currentPath + saveDirParts.shift() + '/';
                                if(!fs.existsSync(currentPath)) {
                                    fs.mkdirSync(currentPath);
                                }
                            }

                            fs.writeFileSync(savePath, content);
                        }
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                };

                let exists = false;
                for(let file of files) {
                    if(fs.existsSync(path.normalize(dir + "/" + file.name))) {
                        exists = true;
                        break;
                    }
                }

                if(exists) {
                    // Request message box from main process
                    ipcRenderer.invoke('show-message-box', {
                        type: 'question',
                        buttons: ["Yes", "No", "Cancel"],
                        message: I18.f('REPLACE_FILES_PROMPT')
                    }).then(result => {
                        if(result.response === 0) { // "Yes" button
                            complete();
                        } else {
                            resolve(); // User cancelled
                        }
                    }).catch(err => {
                        console.error('Error showing message box:', err);
                        reject(err);
                    });
                }
                else {
                    complete();
                }
            }
        });
    }
}

export default Downloader;