# Launch Steps

This is the working launch sequence for the current Construction AR Platform setup as of August 12, 2026.

It covers the full local-development flow that is working right now:

- iPhone development build
- Metro app server
- local WebRTC signaling server
- laptop browser viewer
- phone-to-laptop camera stream

## Before You Start

Make sure all of the following are true:

- The iPhone and laptop are on the same Wi-Fi network.
- The app has already been installed on the iPhone as a development build.
- The iPhone has trusted the developer profile in Settings.
- The local repo path is:

`/Users/s_marlow/Desktop/Glover_Construction/Repo_10Aug/glover_construction/construction-ar-platform`

- The laptop's current local IP address is correct.

For the setup that worked, the laptop IP was:

`192.168.1.186`

If the laptop IP changes later, replace that value everywhere below.

## Step 1: Open the Project Folder

In the VS Code terminal or Mac terminal:

```bash
cd "/Users/s_marlow/Desktop/Glover_Construction/Repo_10Aug/glover_construction/construction-ar-platform"
```

## Step 2: Start Metro for the iPhone App

In Terminal window 1:

```bash
npm start
```

Leave this running.

This serves the app itself on port `8081`.

## Step 3: Start the Local Signaling Server

In Terminal window 2:

```bash
npm run signal
```

Leave this running.

This serves the laptop browser viewer and WebRTC signaling on port `8080`.

## Step 4: Open the Browser Viewer on the Laptop

In the laptop browser, open:

```text
http://192.168.1.186:8080/?room=construction-demo
```

Important:

- This is the laptop viewer page.
- This uses `http://`
- This uses port `8080`

## Step 5: Open the Development Build on the iPhone

On the iPhone:

1. Open the `Construction AR Platform` app.
2. On the development build launcher screen, tap:

```text
Construction AR Platform
http://192.168.1.186:8081
```

Important:

- This launches the app itself from Metro.
- This uses port `8081`
- Do not launch the app from the `ws://...` entry

## Step 6: Open the Stream Screen in the App

Once the app has loaded:

1. Open or select a project.
2. Tap `Stream to laptop`.

## Step 7: Enter the Phone Signaling URL

Inside the app's stream screen, use:

```text
ws://192.168.1.186:8080/signal
```

Room name:

```text
construction-demo
```

Then tap:

`Connect phone`

Important:

- The phone signaling field uses `ws://`
- The phone signaling field uses port `8080`
- The browser viewer and the phone signaling field must use the same room name

## Quick Reference

### App launch URL on phone

```text
http://192.168.1.186:8081
```

### Browser viewer URL on laptop

```text
http://192.168.1.186:8080/?room=construction-demo
```

### Phone signaling URL inside the app

```text
ws://192.168.1.186:8080/signal
```

## If Something Breaks

### If the phone says it cannot connect to `192.168.1.186:8081`

Metro is not running.

Restart:

```bash
npm start
```

### If the phone says `Signaling connection closed`

Usually one of these is wrong:

- `npm run signal` is not running
- the phone signaling URL is incorrect
- the browser viewer is not open
- the phone and laptop are not on the same Wi-Fi
- the room names do not match

### If the phone shows an error about MIME type and says it got `text/html`

The app itself was launched from the wrong server.

That means the phone tried to load the app from the browser viewer server on `8080` instead of Metro on `8081`.

Use:

```text
http://192.168.1.186:8081
```

to launch the app itself.

### If the browser does not load the viewer

Make sure you are opening:

```text
http://192.168.1.186:8080/?room=construction-demo
```

Do not use `ws://` in the browser address bar.

## Notes

- `8081` = Metro / app launch
- `8080` = browser viewer + signaling server
- `http://` = browser viewer or app launcher
- `ws://` = in-app signaling connection only

## Suggested Next Update

After the next milestone, update this file with:

- any new launch commands
- any changed port numbers
- any revised room naming rules
- any new iPhone install or trust steps
