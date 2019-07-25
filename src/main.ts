import * as path from "path";

import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  MenuItem,
  nativeImage,
  session,
  shell,
  Tray
} from "electron";

import config from "./config";
import Idle from "./idle";
import { notify, removeAllNotifications } from "./notifier";
import * as storage from "./storage";
import { isDev } from "./utils";

app.setAppUserModelId("com.Velaro.Velaro");

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow: BrowserWindow;
let settingsWindow: BrowserWindow;
let childWindows: any[] | BrowserWindow[] = [];
let appIcon: Tray = null;

function createWindow() {
  // The electron-spellcheck library has a sub-dependency on rxjs. Rxjs has a bunch
  // of source map declarations that electron doesn't know how to handle correctly.
  // Because of this, our servers were being spammed with requests for source map files
  // anytime a user opened dev tools.
  //
  // We can use the onBeforeRequest handler to intercept requests for source map files
  // and cancel those requests.
  //
  // This handler accepts an optional filter parameter that would make it simple to
  // filter urls like *.js.map, but it's broken.
  // https://electronjs.org/docs/api/web-request
  // https://github.com/electron/electron/issues/11371

  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (details.url.indexOf(".js.map") > -1) {
      console.log("intercepted request for map file:", details.url);
      callback({ cancel: true });
    } else {
      callback({});
    }
  });

  mainWindow = new BrowserWindow({
    title: "Velaro",
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false
    }
  });

  mainWindow.webContents.session.clearCache(() => {});

  mainWindow.loadURL(`file://${__dirname}/views/splash.html`);

  // show the splash screen, check for updates, render
  // the app webview if no updates are available.
  require("./updater")(mainWindow, () => {
    mainWindow.loadURL(config.consoleUrl);

    mainWindow.on("close", e => {
      if (shouldExit === false) {
        e.preventDefault();
        mainWindow.hide();
      }
    });
  });

  if (isDev()) {
    mainWindow.webContents.openDevTools();
  }

  let shouldExit = false;

  const TRAY_ICON_PATH = path.join(__dirname, "resources", "velaro.png");

  const TRAY_AVAILABLE_ICON_PATH = path.join(
    __dirname,
    "resources",
    "velaro-available.png"
  );

  const TRAY_UNAVAILABLE_ICON_PATH = path.join(
    __dirname,
    "resources",
    "velaro-unavailable.png"
  );

  appIcon = new Tray(TRAY_ICON_PATH);

  /**
   * The default window close functionality is set to minimize
   * the application. Call this method if you actually want to close it.
   */
  const exit = () => {
    shouldExit = true;
    app.quit();
  };

  const logout = () => {
    mainWindow.loadURL(`${config.consoleUrl}/account/logout`);
    appIcon.setContextMenu(getTrayMenu(false));
    appIcon.setImage(TRAY_ICON_PATH);
    removeAllNotifications();
  };

  /**
   * The login button doesn't do much. It visually communicates to the
   * user that they are not currently logged in. In this scenario, the
   * app will already be on the login screen, so we just need to focus the window.
   */
  const login = () => {
    mainWindow.focus();
  };

  ipcMain.on("update-tray-icon", (event: any, isLoggedIn: boolean) => {
    appIcon.setContextMenu(getTrayMenu(isLoggedIn));

    if (!isLoggedIn) {
      appIcon.setImage(TRAY_ICON_PATH);
    }
  });

  ipcMain.on("update-tray-availability", (event: any, available: boolean) => {
    if (available) {
      appIcon.setImage(TRAY_AVAILABLE_ICON_PATH);
    } else {
      appIcon.setImage(TRAY_UNAVAILABLE_ICON_PATH);
    }
  });

  const getTrayMenu = (loggedIn: boolean) => {
    // default the value to true. On initial load, if the user
    // is already logged in, nothing happens. If the user is
    // not logged in, the login screen will load and trigger a
    // method to set this value to false.
    loggedIn = loggedIn === undefined ? true : loggedIn;

    const options = [
      {
        label: "Exit",
        accelerator: "Alt+F4",
        click() {
          exit();
        }
      }
    ];

    const loginButton = {
      label: "Login",
      click() {
        login();
      }
    };

    const logoutButton = {
      label: "Logout",
      click() {
        logout();
      }
    };

    if (loggedIn) {
      options.push(logoutButton);
    } else {
      options.push(loginButton);
    }

    return Menu.buildFromTemplate(options);
  };

  appIcon.setToolTip("Velaro Live Chat");
  appIcon.setContextMenu(getTrayMenu());

  appIcon.on("click", () => {
    if (!mainWindow) {
      return;
    }

    mainWindow.show();
  });

  const menu = Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [
        {
          label: "Settings",
          click() {
            if (settingsWindow) {
              settingsWindow.focus();
              return;
            }

            settingsWindow = new BrowserWindow({
              title: "Settings",
              height: 300,
              width: 400
            });

            settingsWindow.on("closed", () => {
              settingsWindow = null;
            });

            settingsWindow.loadURL(`file://${__dirname}/views/settings.html`);
            childWindows.push(settingsWindow);

            if (isDev()) {
              settingsWindow.openDevTools();
            }
          }
        },
        {
          label: "Exit",
          accelerator: "Alt+F4",
          click() {
            exit();
          }
        }
      ]
    },
    {
      label: "Window",
      submenu: [
        {
          label: "Developer Tools ",
          accelerator: "F12",
          click() {
            mainWindow.toggleDevTools();
          }
        },
        {
          label: "Refresh",
          accelerator: "F5",
          click() {
            mainWindow.reload();
          }
        }
      ]
    }
  ]);

  Menu.setApplicationMenu(menu);

  // Emitted when the window is closed.
  mainWindow.on("closed", () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;

    settingsWindow = null;

    childWindows.forEach(win => {
      try {
        win.close();
      } catch (err) {
        console.error(err);
      }
    });

    childWindows = [];
    removeAllNotifications();

    appIcon.destroy();
    appIcon = null;
    idle.dispose();
  });
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
  return;
}

app.on("second-instance", () => {
  // User tried to run a second instance, we should focus our window.
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }
});

const settings = storage.get("settings") || {};
let idle: {
  dispose: () => void;
  on: {
    (arg0: string, arg1: () => void): void;
    (arg0: string, arg1: () => void): void;
  };
  seconds: any;
};

ipcMain.on("push-sender", (event: { sender: any }) => {
  // make sure this setup only happens once, otherwise when the window is refreshed these events get hooked up again
  // and bad things happen.
  if (ipcMain.push_sender) {
    return;
  }

  ipcMain.push_sender = true;

  idle = new Idle(settings.idleSeconds || 300); // default idle time is 5 minutes
  const sender = event.sender;

  idle.on("idle", () => {
    if (settings.idleTimeEnabled !== false) {
      sender.send("idle");
    }
  });

  idle.on("active", () => {
    if (settings.idleTimeEnabled !== false) {
      sender.send("active");
    }
  });

  ipcMain.on("desktop-notify", (event: any, options: any) => {
    notify(options);
  });
});

ipcMain.on("get-settings", (event: { returnValue: any }) => {
  event.returnValue = storage.get("settings");
});

ipcMain.on("get-version", (event: { returnValue: string }) => {
  event.returnValue = app.getVersion();
});

ipcMain.on(
  "save-settings",
  (
    event: { returnValue: any },
    newSettings: { idleSeconds: any; idleTimeEnabled: any }
  ) => {
    storage.set("settings", newSettings);
    idle.seconds = newSettings.idleSeconds;
    settings.idleTimeEnabled = newSettings.idleTimeEnabled;
    event.returnValue = newSettings;
  }
);

ipcMain.on("open-external-link", (event: any, url: string) => {
  shell.openExternal(url);
});

ipcMain.on(
  "set-badge",
  (event: any, data: { badgeData: string; text: string }) => {
    try {
      if (!data) {
        mainWindow.setOverlayIcon(null, "");
        return;
      }

      const img = nativeImage.createFromDataURL(data.badgeData);
      mainWindow.setOverlayIcon(img, data.text);
    } catch (ex) {
      console.error("error in set-badge", ex);
    }
  }
);

ipcMain.on("set-flash-frame", (event: any, val: boolean) => {
  try {
    mainWindow.flashFrame(val);
  } catch (ex) {
    console.error("error in set-flash-frame", ex);
  }
});

ipcMain.on("acceptEngagement", (event: any, args: any) => {
  mainWindow.focus();
  mainWindow.webContents.send("accept", args);
});

ipcMain.on("rejectEngagement", (event: any, args: any) => {
  mainWindow.webContents.send("reject", args);
});

ipcMain.on("ignoreEngagement", (event: any, args: any) => {
  mainWindow.webContents.send("ignore", args);
});

ipcMain.on("viewEngagement", (event: any, args: any) => {
  mainWindow.focus();
  mainWindow.webContents.send("view", args);
});

ipcMain.on("viewInfo", (event: any, args: any) => {
  mainWindow.focus();
  mainWindow.webContents.send("info", args);
});

ipcMain.on("availabilityChanged", (event: any, args: any) => {
  console.log("event:", event);
  console.log("args:", args);
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", createWindow);

// Quit when all windows are closed.
app.on("window-all-closed", () => {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow();
  }
});
