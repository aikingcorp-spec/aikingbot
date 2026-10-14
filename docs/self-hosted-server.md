# Self-hosted servers

A self-hosted server is the Linux AIKINGBOT build on your own computer with no screen: a VPS, a home
server or a cloud VM. It is a normal Remote host of your account. You use it from the desktop app,
the iPhone app or `aikingbot.aikingx.com/app`, as you use a [hosted server](hosted-servers.md). You install
and control it from a terminal.

To run it in a container, see [Docker](docker.md).

## Install

On Ubuntu 24.04 (x86_64 or arm64) with systemd:

```sh
curl -fsSL https://raw.githubusercontent.com/aikingcorp-spec/aikingx_bot/main/scripts/install-server.sh | sudo bash
sudo aikingbot login
```

`aikingbot login` asks for your email and the code that AIKINGBOT sends to it. After the sign-in, the
server shows in the server list of that account. Its name is "AIKINGBOT"; give another one with
`sudo aikingbot login --name <name>` or `sudo aikingbot name <name>`. A name has 6 to 32 characters.
Then connect a provider from the app, as on a hosted server (see
[Providers](hosted-servers.md#providers)).

Install options go after `sudo bash -s --`:

| Option | Default | Use |
| --- | --- | --- |
| `--user <name>` | the installed user, else `aikingbot` | The user that runs AIKINGBOT and its agents. The install makes it when it does not exist, with its home folder in `/var/lib/<name>`. |
| `--auth-api-url <origin>` | the installed one, else the URL in the build | Another account server, for example the `test` Worker or a [self-hosted account service](self-hosting.md). |

Run the install again to reinstall or upgrade. The data stays in the home folder of the service
user. A reinstall keeps the user and the account server, because the sign-in belongs to them, and
refuses another `--user`. The install refuses an older release than the installed one, because an older AIKINGBOT cannot
open a database that a newer one migrated. It also refuses a computer that is a hosted server.

## Commands

| Command | Use |
| --- | --- |
| `aikingbot status` | Show the version, the account, the server state and a staged update. |
| `aikingbot login [<email>] [--name <name>]` | Sign in with an email code. |
| `aikingbot mobile-connect` | Show a Mobile Connect QR code for the phone app (see [Phone app](#phone-app)). |
| `aikingbot logout` | Sign out. The server is not available until the next sign-in. |
| `aikingbot name <name>` | Change the server name. |
| `aikingbot logs [-f]` | Show the journal of `aikingbot.service`. |
| `sudo aikingbot start\|stop\|restart` | Control `aikingbot.service`. |
| `sudo aikingbot update` | Download, check and install the newest release now. |
| `sudo aikingbot uninstall` | Sign out and remove AIKINGBOT. The data stays (see [Remove](#remove)). |
| `aikingbot version` | Show the installed version. |

Run the account commands with `sudo` or as the service user. Other users cannot open the control
socket.

## Phone app

The phone app has no email sign-in. It signs in with a Mobile Connect code. A server has no screen
for the code, so `aikingbot mobile-connect` shows it in the terminal:

1. Sign in the server with `aikingbot login`.
2. Run `aikingbot mobile-connect`. In a container, run `docker exec -it <container> aikingbot mobile-connect`.
3. In the phone app, select **Scan QR code** and scan the code in the terminal.

The code signs the phone in to the account of the server. It works for one sign-in and expires after
two minutes. The phone then shows all servers of the account, and it opens this server first. The
phone connects through the account server and Signal, as the desktop app does. The server publishes
no port.

If the phone app is already connected to the same account from the desktop app, the server is
already in its server list. Remove a phone from the account in the desktop app, in
**Settings > Mobile Connect**.

## Remove

`sudo aikingbot uninstall` signs out, then removes the service, the units, the AppArmor profile, the
`aikingbot` command and the server files in `/opt/AIKINGBOT`. It keeps the home folder of the service user
and the keyring in `/srv/aikingbot-hosted`. The keyring has the key of the encrypted data in that home
folder, so keep or delete the two together. An install with the same `--user` uses them again. To
delete the data too:

```sh
sudo userdel --remove aikingbot && sudo rm -rf /srv/aikingbot-hosted
```

The server stays in the server list of the account, offline. Remove it there.

## How it works

`install-server.sh` only downloads the release. It reads `latest-linux.yml`
(`latest-linux-arm64.yml` on arm64) of the latest GitHub release, checks the SHA-512 of the
AppImage, unpacks it and runs `resources/hosting/aikingbot-server-setup` from that release. So the
install steps always match the build that they install. A release before this feature has no setup
file, and the install stops with a message.

`aikingbot-server-setup` uses the install steps of a hosted server (`aikingbot-hosted-update`): it
installs the packages in `packages.txt`, copies the release to `/opt/AIKINGBOT/app`, and installs the
scripts, the AppArmor profile and the units. It writes `self` to `/opt/AIKINGBOT/hosted/mode` and
links `/usr/local/bin/aikingbot`.

With `mode` set to `self`, `aikingbot-hosted-server` does not wait for a claim or for a boat desktop.
It starts a D-Bus session with an unlocked keyring, as on a hosted server, and runs AIKINGBOT under
Xvfb with `AIKINGBOT_SERVER=1`. Main (`src/main/server-mode.ts`) then opens the control socket
`/run/aikingbot/control.sock` and publishes the host after each sign-in.

Updates work as on a hosted server (see [Updates](hosted-servers.md#updates)): the timer stages a
new release, and it starts at the next boot, or when an owner, an admin or a permitted member
installs it in Server Settings > Updates. `sudo aikingbot update` stages, stops the service, applies
and starts the service again.

## Control socket

The `aikingbot` command talks to main over HTTP on a Unix socket, with form bodies and `key=value`
text answers, so it needs only `curl`. The routes are `GET /v1/status`, `POST /v1/login/start`,
`POST /v1/login/verify`, `POST /v1/name` and `POST /v1/logout`.

Threat model:

- systemd makes `/run/aikingbot` for the service user with mode 0700, and main makes the socket 0600.
  Main refuses to listen when the directory belongs to another user or other users can enter it. It
  never removes a file at the socket path that is not a socket.
- Only the service user and root can connect. Agents run as the service user and already have full
  access to its files, its keyring and the AIKINGBOT database, so the socket gives them nothing new.
- The socket answers a closed list of requests. It never sends the session token or the sign-in
  code back, and a value cannot add a line to an answer. A body is at most 4 KiB.
- Server mode starts only in a packaged Linux build with `AIKINGBOT_SERVER=1`, and never on a hosted
  server, which signs in with its claim.

## Not confirmed

- The full install runs only on Ubuntu 24.04 in tests. On Debian 12, Debian 13 and Ubuntu 26.04,
  only the package step is tested (`apt-get --dry-run`). Debian 12 names some libraries without the
  `t64` suffix, and the install uses those names. Debian 13 and Ubuntu 26.04 have no
  `libminiupnpc17`, so the install skips it with a warning, and the remote desktop runtime can fail
  to start there.
- The full install was not run on a Linux computer before the first release that has the setup
  file. It needs a release build.
