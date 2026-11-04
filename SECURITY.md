# Security

## Reporting a vulnerability

Please do not open a public issue. Use [Report a vulnerability](https://github.com/Thrashy190/eco/security/advisories/new), which stays private between you and the maintainer. Say what an attacker could do and how to reproduce it.

Eco is maintained in spare time, so an answer can take some days. There is no bug bounty.

## Supported versions

Only the [latest release](https://github.com/Thrashy190/eco/releases/latest) gets fixes.

## What is in scope

Eco runs on your own server and signs people in with their Navidrome accounts. These matter most:

- one signed-in user reaching another user's data or devices
- a non-administrator deleting songs or doing anything else reserved for administrators
- making the server fetch addresses it should not, or read or write outside its data folder
- credentials showing up where they should not, such as logs

Anything that needs administrator access to your server already, or that comes from exposing a port directly to the internet against [the deployment guide](docs/deployment.md), is out of scope.
