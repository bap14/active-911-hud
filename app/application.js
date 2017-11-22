"use strict";
var path = require('path'),
    devMode = (process.argv || []).indexOf('--dev') !== -1;
if (devMode) {
    var PATH_APP_NODE_MODULES = path.join(__dirname, '..', 'app', 'node_modules');
    require('module').globalPaths.push(PATH_APP_NODE_MODULES);
}

const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const ipcMain = electron.ipcMain;
const remote = electron.remote;
const fs = require('graceful-fs');
const os = require('os');
let settingsWindow,
    splashScreen,
    hudWindow,
    oauthWindow,
    iconName = "active911.ico",
    appIcon = path.join(__dirname, "images", "icons");

if (os.platform().toLowerCase() === "darwin") {
    iconName = "active911.icns";
}
appIcon = path.join(appIcon, iconName);

global.active911Settings = require('./lib/active911Settings.js')();
global.active911 = require('./lib/active911.js')(global.active911Settings);

function checkOAuthToken() {
    let auth = active911Settings.get('active911auth'),
        expiresAt = new Date(auth.token.expires_at);
    console.log(expiresAt);
}

function createHUDWindow() {
    hudWindow = new BrowserWindow({ width: 1920, height: 1080, frame: false, show: false, icon: appIcon, fullscreen: true });
    hudWindow.hide();
    hudWindow.loadURL('file://' + __dirname + '/views/monitor.html');
    hudWindow.webContents.on('did-finish-load', () => {
        hudWindow.show();

        if (splashScreen) {
            splashScreen.close();
        }
    });
    hudWindow.on('closed', () => hudWindow = null);

    // TODO: Start timer, every 60 minutes check if OAuth token needs refresh
    checkOAuthToken();
}

function createOauthWindow(authUri) {
    splashScreen.send('add-status-message', 5);
    oauthWindow = new BrowserWindow({ width: 800, height: 560, parent: hudWindow, modal: true, frame: true, icon: appIcon, show: false });
    oauthWindow.once('ready-to-show', () => {
        oauthWindow.show();
    });
    oauthWindow.loadURL(authUri);
    oauthWindow.webContents.on('did-finish-load', (evt)  => {
        oauthWindow.show();
        let loadedUrl = oauthWindow.webContents.getURL();

        if (/bap14\.github\.io\/active911-hud\/oauth\.html/.test(loadedUrl) ||
            /(www\.)?winfieldvfd\.org/.test(loadedUrl)
        ) {
            oauthWindow.hide();
            let uri = active911.parseURI(loadedUrl);

            splashScreen.send('add-status-message', 20);
            active911.exchangeAuthToken(uri.queryKey.code);
        }
    });
    oauthWindow.on("closed", () => {
        oauthWindow = null;
        splashScreen.show();
    });
}

function createSplashScreen() {
    splashScreen = new BrowserWindow({ width: 600, height: 280, frame: false, show: false, icon: appIcon });
    splashScreen.loadURL("file://" + __dirname + "/views/splash.html");
    splashScreen.on('closed', () => splashScreen = null);
    splashScreen.webContents.on('did-finish-load', () => {
        splashScreen.show();
    });
}

function createSettingsWindow(errorMessage) {
    settingsWindow = new BrowserWindow({
        width: 400,
        height: 540,
        parent: splashScreen,
        frame: true,
        icon: appIcon,
        show: false,
        autoHideMenuBar: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false
    });
    settingsWindow.hide();
    settingsWindow.errorMessage = errorMessage || false
    settingsWindow.loadURL('file://' + __dirname + '/views/settings.html');
    settingsWindow.on('closed', () => settingsWindow = null);
    settingsWindow.webContents.on('did-finish-load', () => {
        settingsWindow.show();

        if (settingsWindow.errorMessage) {
            settingsWindow.send('show-login-error', settingsWindow.errorMessage);
        }

        if (splashScreen) {
            //splashScreen.hide();
        }
    });
}

app.on('window-all-closed', () => {
    app.quit();
});
app.on('ready', () => {
    createSplashScreen();
});
app.on('activate', () => {
    if (hudWindow === null) {
        createHUDWindow();
    }
});

const isExtraInstance = app.makeSingleInstance((commandLine, workingDirectory) => {
   if (hudWindow !== null) {
       if (hudWindow.isMinimized()) hudWindow.restore();
       hudWindow.focus();
   }
   console.log(commandLine);
});
if (isExtraInstance) app.quit();

app.setAsDefaultProtocolClient('active911hud');

ipcMain.on('show-settings-window', () => {
    createSettingsWindow();
});

ipcMain.on('check-oauth', () => {
    active911.validateToken();
});
ipcMain.on('oauth-authorize', (authUri) => {
    createOauthWindow(authUri);
});
ipcMain.on('oauth-error', (error) => {
    console.error(error);
});
ipcMain.on('oauth-complete', () => {
    if (oauthWindow) {
        oauthWindow.close();
    }

    splashScreen.send('add-status-message', 70);

    if (!active911Settings.getGoogleMapsApiKey()) {
        createSettingsWindow();
    } else {
        splashScreen.send('add-status-message', 100);
        createHUDWindow();
    }


});
ipcMain.on('settings-saved', () => {
    if (!hudWindow || hudWindow.isHidden()) {
        settingsWindow.close();
        splashScreen.show();
        splashScreen.send('add-update-message', 100);
        createHUDWindow();
    } else {
        // Reinitialize with new settings
        hudWindow.close();
        createSplashScreen();
    }
});
ipcMain.on('login-failure', (evt, message) => {
    createSettingsWindow(message);
});
ipcMain.on('console.log', (evt, message) => {
    console.log(message);
});