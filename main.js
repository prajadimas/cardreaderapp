// Modules to control application life and create native browser window
const { app, BrowserWindow, ipcMain } = require('electron')
const os = require('os')
const path = require('path')
const url = require('url')
const WebSocket = require('ws')

// Initiate socket, timeout prop, userid, connection string and check ip origin
var socket
var timeoutConn
var reconnectInterval = 1 * 1000 * 60
var userid = ''
var connString = ''
var ip = []

var ifaces = os.networkInterfaces()

Object.keys(ifaces).forEach(function (ifname) {
  var alias = 0
  ifaces[ifname].forEach(function (iface) {
    if ('IPv4' !== iface.family) {
      // skip over non-ipv4 addresses
      return
    }
    if (alias >= 1) {
      // this single interface has multiple ipv4 addresses
      console.log(ifname + ':' + alias, iface.address)
      ip.push(iface.address)
    } else {
      // this interface has only one ipv4 adress
      console.log(ifname, iface.address)
      ip.push(iface.address)
    }
    ++alias
  })
})

// Using PCSClite library
var pcsc = require('pcsclite')()

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow

function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 800,
		height: 600,
    webPreferences: {
      // nodeIntegration: true,
      contextIsolation: true, // protect against prototype pollution
      enableRemoteModule: false, // turn off remote
      preload: path.join(__dirname, 'preload.js')
    }
  })

  // and load the index.html of the app.
  // mainWindow.loadFile('index.html')
  mainWindow.loadURL(url.format({
    pathname: path.join(__dirname, 'index.html'),
    protocol: 'file:',
    slashes: true
  }))

  // Open the DevTools.
  // mainWindow.webContents.openDevTools()

  // Emitted when the window is closed.
  mainWindow.on('closed', function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow()

  app.on('activate', function () {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null) {
      createWindow()
    }
  })

  pcsc.on('reader', function (reader) {
    console.log('Reader detected', reader.name)
    if (reader.name.includes('Dual Reader')) {
      mainWindow.webContents.send('fromMain', {
        elementid: 'reader-status',
        value: 'Readers detected (' + reader.name.split('(')[0] + ')'
      })
    } else {
      mainWindow.webContents.send('fromMain', {
        elementid: 'reader-status',
        value: 'Reader detected (' + reader.name + ')'
      })
    }
    reader.on('error', function (err) {
      console.log('Error(', this.name, '):', err.message)
    })
    reader.on('status', function (status) {
      console.log('Status(', this.name, '):', status)
      var changes = this.state ^ status.state
      if (changes) {
        if ((changes & this.SCARD_STATE_EMPTY) && (status.state & this.SCARD_STATE_EMPTY)) {
          console.log("Card removed"); // card removed
          mainWindow.webContents.send('fromMain', {
            elementid: 'card-uid',
            value: 'Removed'
          })
          reader.disconnect(reader.SCARD_LEAVE_CARD, function (err) {
            if (err) {
              console.log("Card state empty [err] : " + err)
            } else {
              console.log('Disconnected')
            }
          })
        } else if ((changes & this.SCARD_STATE_PRESENT) && (status.state & this.SCARD_STATE_PRESENT)) {
          console.log("Card inserted") // card inserted
          mainWindow.webContents.send('fromMain', {
            elementid: 'card-uid',
            value: 'Inserted'
          })
          reader.connect({ share_mode : this.SCARD_SHARE_SHARED }, function (err, protocol) {
            if (err) {
              console.log("Card state present [err] : " + err)
            } else {
              console.log('Protocol (', reader.name, '):', protocol)
              reader.transmit(Buffer.from([0xFF, 0xCA, 0x00, 0x00, 0x00]), 255, protocol, function (err, resData) {
                buf = ''
                for (var i = 0; i < resData.length - 2; i++) {
                  buf += resData[i].toString(16).toUpperCase().padStart(2,'0')
                }
                console.log('UserID ', userid)
                console.log('Response ', buf)
                if (socket) {
                  socket.send(JSON.stringify({
                    user: userid,
                    data: buf
                  }))
                }
                mainWindow.webContents.send('fromMain', {
                  elementid: 'card-uid',
                  value: 'Get card ID: ' + buf
                })
              })
            }
          })
        }
      }
    })
    reader.on('end', function () {
      console.log('Reader',  this.name, 'removed')
      if (this.name.includes('Dual Reader')) {
        mainWindow.webContents.send('fromMain', {
          elementid: 'reader-status',
          value: 'Readers (' + this.name.split('(')[0] + ') is removed'
        })
      } else {
        mainWindow.webContents.send('fromMain', {
          elementid: 'reader-status',
          value: 'Reader (' + reader.name + ') is removed'
        })
      }
      reader.close()
    })
  })
  pcsc.on('error', function (err) {
    console.log('PCSC error', err.message)
  })

})

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  app.quit()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
ipcMain.on('toMain', (event, args) => {
  console.log('Args ', args)
  var socketFun = function () {
    console.log('Connection String ', connString)
    if (connString) {
      socket = new WebSocket(connString)
      socket.on('open', function () {
        console.log('Socket open')
        mainWindow.webContents.send('fromMain', {
          elementid: 'connection-status',
          value: 'Connected to ' + connString
        })
      })
      socket.on('message', function (data) {
        userid = JSON.parse(data).id
        console.log('UserID ', userid)
      })
      socket.on('error', function (evt) {
        console.log('Socket error ', evt)
      })
      socket.on('close', function () {
        console.log('Socket close')
        userid = ''
        mainWindow.webContents.send('fromMain', {
          elementid: 'connection-status',
          value: 'Disconnected'
        })
        timeoutConn = setTimeout(function () {
          socketFun()
        }, reconnectInterval)
      })
    }
  }
  if (args.type === 'connect') {
    connString += args.protocol + '://' + args.host + ':' + args.port
    args.path ? connString += '/' + args.path : connString += ''
    socketFun()
  } else if (args.type === 'disconnect') {
    socket.close()
    clearTimeout(timeoutConn)
    connString = ''
    // app.relaunch()
    // app.exit()
  }
})
