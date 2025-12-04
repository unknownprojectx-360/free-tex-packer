const path = require('path');
const tinify = require('tinify');
const argv = require('optimist').argv;
const windowStateKeeper = require('electron-window-state');
const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const { autoUpdater } = require("electron-updater");
require('@electron/remote/main').initialize();

let mainWindow;
let RECENT_PROJECTS = [];
let CURRENT_LOCALE = "";
let LOCALE_STRINGS = {};
let APP_INFO = {};
let LANGUAGES = [];
let CURRENT_PROJECT = "";
let CURRENT_PROJECT_MODIFIED = false;
let fileToOpen = null;

function createWindow() {
    let w = 1300;
    let h = 700;

    if (process.platform === "win32") {
        w = 1320;
        h = 740;
    }

    // The electron-window-state module accesses the screen module internally
    // which can only be used after the app is ready. We need to ensure this
    // happens after app ready event, particularly when handling file associations
    // Initialize window state after app is ready
    const initWindow = () => {
        let mainWindowState = windowStateKeeper({
            defaultWidth: w,
            defaultHeight: h
        });

        mainWindow = new BrowserWindow({
            x: mainWindowState.x,
            y: mainWindowState.y,
            width: mainWindowState.width,
            height: mainWindowState.height,
            minWidth: w,
            minHeight: h,
            title: "",
            icon: path.resolve(__dirname, 'www/static/images/icon.png'),
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        mainWindowState.manage(mainWindow);
        return mainWindow;
    };

    // If app is already ready, create window immediately
    if (app.isReady()) {
        initWindow();
    } else {
        // Wait for app ready event before creating window
        app.whenReady().then(() => {
            initWindow();
            // Execute the rest of createWindow functionality after window is created
            setupWindow();
        });
        return; // Early return to avoid executing the rest of the function before app is ready
    }

    // Execute setup only after window is created
    setupWindow();
}

function setupWindow() {
    require("@electron/remote/main").enable(mainWindow.webContents);

    mainWindow.on('page-title-updated', function (e) {
        e.preventDefault();
    });

    if (argv.env === 'development') {
        mainWindow.loadURL('http://localhost:4000/');
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile(path.join(__dirname, 'www/index.html'));
        // Open DevTools in production for debugging
        // mainWindow.webContents.openDevTools();
    }

    Menu.setApplicationMenu(null);

    mainWindow.on('close', function (e) {
        if (CURRENT_PROJECT_MODIFIED) {
            sendMessage({ actionName: 'quit' });
            e.preventDefault();
        }
    });

    mainWindow.on('closed', function () {
        mainWindow = null;
    });

    mainWindow.webContents.on('will-navigate', handleRedirect);
    mainWindow.webContents.on('new-window', handleRedirect);

    mainWindow.webContents.on('did-finish-load', function () {
        CURRENT_PROJECT = "";
        CURRENT_PROJECT_MODIFIED = false;
        updateWindowTitle();

        autoUpdater.checkForUpdates();
    });

    ipcMain.on('app-ready', () => {
        if (argv.env !== 'development' && process.argv.length > 1) {
            sendMessage({ actionName: 'project-load', custom: process.argv[1] });
        }

        if (fileToOpen) {
            sendMessage({ actionName: 'project-load', custom: fileToOpen });
            fileToOpen = null;
        }
    });

    mainWindow.webContents.on('context-menu', showInputContextMenu);

    startAutoUpdater();

    onProjectUpdated();
}

function showInputContextMenu(e, props) {
    if (!props.isEditable) return;

    const menu = Menu.buildFromTemplate([
        {
            label: LOCALE_STRINGS.CONTEXT_MENU_UNDO,
            role: 'undo',
            enabled: props.editFlags.canUndo,
            accelerator: 'CmdOrCtrl+Z'
        },
        {
            label: LOCALE_STRINGS.CONTEXT_MENU_REDO,
            role: 'redo',
            enabled: props.editFlags.canRedo,
            accelerator: 'CmdOrCtrl+Shift+Z'
        },
        {
            type: 'separator',
        },
        {
            label: LOCALE_STRINGS.CONTEXT_MENU_CUT,
            role: 'cut',
            enabled: props.editFlags.canCut,
            accelerator: 'CmdOrCtrl+X'
        },
        {
            label: LOCALE_STRINGS.CONTEXT_MENU_COPY,
            role: 'copy',
            enabled: props.editFlags.canCopy,
            accelerator: 'CmdOrCtrl+C'
        },
        {
            label: LOCALE_STRINGS.CONTEXT_MENU_PASTE,
            role: 'paste',
            enabled: props.editFlags.canPaste,
            accelerator: 'CmdOrCtrl+V'
        },
        {
            label: LOCALE_STRINGS.CONTEXT_MENU_DELETE,
            role: 'delete',
            enabled: props.editFlags.canDelete,
            accelerator: 'Del'
        },
        {
            type: 'separator',
        },
        {
            label: LOCALE_STRINGS.CONTEXT_MENU_SELECT_ALL,
            role: 'selectall',
            enabled: props.editFlags.canSelectAll,
            accelerator: 'CmdOrCtrl+A'
        }
    ]);

    menu.popup(mainWindow);
}

function startAutoUpdater() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on('checking-for-update', () => {
    });

    autoUpdater.on('update-available', (info) => {
        mainWindow.send('update-available', info);
    });

    autoUpdater.on('update-not-available', (info) => {
    });

    autoUpdater.on('error', (err) => {
    });

    autoUpdater.on('download-progress', (progressObj) => {
        mainWindow.send('download-progress', progressObj.percent);
    });

    autoUpdater.on('update-downloaded', (info) => {
        autoUpdater.quitAndInstall(true, true);
    });

    ipcMain.on('install-update', (e, data) => {
        autoUpdater.downloadUpdate();
    });
}

function handleRedirect(e, url) {
    if (url !== mainWindow.getURL()) {
        e.preventDefault();
        shell.openExternal(url);
    }
}

function buildMenu() {
    let template = [];

    let recentProjects = [];

    if (RECENT_PROJECTS.length) {
        for (let path of RECENT_PROJECTS) {
            let name = path.split("/").pop();
            recentProjects.push({ label: name, actionName: 'project-load', click: sendMessage, custom: path });
        }
    }
    else {
        recentProjects.push({ label: "...", enabled: false });
    }

    let quitAcc = "CmdOrCtrl+F4";
    if (process.platform === "darwin") quitAcc = "CmdOrCtrl+Q";

    template.push({
        label: LOCALE_STRINGS.MENU_FILE,
        submenu: [
            { label: LOCALE_STRINGS.MENU_FILE_PROJECT_NEW, actionName: 'project-new', click: sendMessage, accelerator: 'CmdOrCtrl+N' },
            { label: LOCALE_STRINGS.MENU_FILE_PROJECT_LOAD, actionName: 'project-load', click: sendMessage, accelerator: 'CmdOrCtrl+O' },
            { label: LOCALE_STRINGS.MENU_FILE_PROJECT_LOAD_RECENT, submenu: recentProjects },
            { type: 'separator' },
            { label: LOCALE_STRINGS.MENU_FILE_PROJECT_SAVE, actionName: 'project-save', click: sendMessage, accelerator: 'CmdOrCtrl+S' },
            { label: LOCALE_STRINGS.MENU_FILE_PROJECT_SAVE_AS, actionName: 'project-save-as', click: sendMessage, accelerator: 'CmdOrCtrl+Shift+N' },
            { type: 'separator' },
            { label: LOCALE_STRINGS.MENU_FILE_PREFERENCES_SAVE, actionName: 'preferences-save', click: sendMessage },
            { type: 'separator' },
            { label: LOCALE_STRINGS.MENU_FILE_INSTALL_CLI, click: installCLI },
            { type: 'separator' },
            { label: LOCALE_STRINGS.MENU_FILE_EXIT, actionName: 'quit', click: sendMessage, accelerator: quitAcc }
        ]
    });

    template.push({
        label: LOCALE_STRINGS.MENU_ACTIONS,
        submenu: [
            { label: LOCALE_STRINGS.MENU_ACTIONS_ADD_IMAGES, actionName: 'action-add-images', click: sendMessage, accelerator: 'Shift+A' },
            { label: LOCALE_STRINGS.MENU_ACTIONS_ADD_FOLDER, actionName: 'action-add-folder', click: sendMessage, accelerator: 'Shift+F' },
            { type: 'separator' },
            { label: LOCALE_STRINGS.MENU_ACTIONS_SELECT_ALL, actionName: 'action-select-all', click: sendMessage, accelerator: 'CmdOrCtrl+A' },
            { label: LOCALE_STRINGS.MENU_ACTIONS_DELETE, actionName: 'action-delete', click: sendMessage, accelerator: 'Delete' },
            { label: LOCALE_STRINGS.MENU_ACTIONS_CLEAR, actionName: 'action-clear', click: sendMessage, accelerator: 'CmdOrCtrl+Shift+C' },
            { type: 'separator' },
            { label: LOCALE_STRINGS.MENU_ACTIONS_EXPORT, actionName: 'action-export', click: sendMessage, accelerator: 'CmdOrCtrl+E' }
        ]
    });

    template.push({
        label: LOCALE_STRINGS.MENU_TOOLS,
        submenu: [
            { label: LOCALE_STRINGS.MENU_TOOLS_SPLITTER, actionName: 'action-show-splitter', click: sendMessage, }
        ]
    });

    let langs = [];
    if (LANGUAGES.length) {
        for (let lang of LANGUAGES) {
            langs.push({
                label: lang.name,
                custom: lang.lang,
                checked: CURRENT_LOCALE === lang.lang,
                type: 'checkbox',
                actionName: 'change-locale',
                click: sendMessage
            });
        }
    }

    template.push({
        label: LOCALE_STRINGS.MENU_LANGUAGE,
        submenu: langs
    });

    template.push({
        label: LOCALE_STRINGS.MENU_HELP,
        submenu: [
            { label: LOCALE_STRINGS.MENU_HELP_ABOUT, actionName: 'show-about', click: sendMessage, accelerator: 'F1' }
        ]
    });

    if (argv.env === 'development') {
        template.push({
            label: 'Dev', submenu: [
                { label: 'Console', click: () => mainWindow.webContents.openDevTools() },
                { label: 'Reload', click: () => mainWindow.webContents.reload() }
            ]
        });
    }

    let menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

function installCLI() {
    shell.openExternal('https://github.com/odrick/free-tex-packer-cli');
}

function quit() {
    CURRENT_PROJECT_MODIFIED = false;
    app.quit();
}

function sendMessage(e) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    let payload = null;
    if (e.custom) {
        payload = { data: e.custom };
    }

    mainWindow.send(e.actionName, payload);
}

function onProjectUpdated(data = null) {
    CURRENT_PROJECT = data ? data.path : "";
    CURRENT_PROJECT_MODIFIED = false;
    updateWindowTitle();
}

function onProjectModified(data = null) {
    CURRENT_PROJECT_MODIFIED = data ? data.val : false;
    updateWindowTitle();
}

function updateWindowTitle() {
    if (!APP_INFO.displayName) {
        mainWindow.setTitle("");
        return;
    }

    let name;

    if (!CURRENT_PROJECT) name = "untitled.ftpp";
    else name = CURRENT_PROJECT.split('/').pop();

    mainWindow.setTitle((CURRENT_PROJECT_MODIFIED ? "* " : "") + name + ' - ' + APP_INFO.displayName);
}

app.on('open-file', (event, path) => {
    event.preventDefault();
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        sendMessage({ actionName: 'project-load', custom: path });
    } else {
        fileToOpen = path;
        // Only create window if app is ready, otherwise wait for ready event
        if (app.isReady()) {
            createWindow();
        }
        // If app is not ready, the createWindow will be called by the 'ready' event handler
        // which will handle the fileToOpen automatically
    }
});

app.on('ready', createWindow);

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
    }
});

ipcMain.on('tinify', (e, data) => {
    tinify.key = data.key;
    tinify.fromBuffer(Buffer.from(data.imageData, 'base64')).toBuffer((err, res) => {
        if (err) {
            e.sender.send('tinify-complete', {
                success: false,
                uid: data.uid,
                error: err.message
            });
            return;
        }

        e.sender.send('tinify-complete', {
            success: true,
            uid: data.uid,
            data: res.toString('base64')
        });
    });
});

ipcMain.on('update-app-info', (e, data) => {
    APP_INFO = data;
    buildMenu();
    updateWindowTitle();
});

ipcMain.on('update-languages', (e, data) => {
    LANGUAGES = data;
    buildMenu();
});

ipcMain.on('update-locale', (e, data) => {
    CURRENT_LOCALE = data.currentLocale;
    LOCALE_STRINGS = data.strings;
    buildMenu();
});

ipcMain.on('project-recent-update', (e, data) => {
    RECENT_PROJECTS = data.projects;
    buildMenu();
});

ipcMain.on('project-update', (e, data) => {
    onProjectUpdated(data);
});

ipcMain.on('project-modified', (e, data) => {
    onProjectModified(data);
});

ipcMain.on('quit', (e, data) => {
    quit();
});

ipcMain.handle('show-open-dialog', async (event, options) => {
    const result = await require('electron').dialog.showOpenDialog({
        properties: options.properties
    });
    return result;
});

ipcMain.handle('show-message-box', async (event, options) => {
    const result = await require('electron').dialog.showMessageBox(options);
    return result;
});
