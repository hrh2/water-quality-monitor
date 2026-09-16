# Chapter 7: Firmware

The ESP8266 firmware (`firmware/firmware.ino`) does more than read
sensors and publish JSON - a significant portion of it is dedicated to
making an unattended, field-deployed device recoverable without physical
access: a WiFiManager captive-portal setup flow, a serial command
interface (`show`/`config`/`reset`/`set`), and a remote `set_config`
command deliverable over the same WebSocket connection the device already
uses for readings. All three configuration paths, and the WiFi
boot-retry/mid-run-reconnect backoff logic that sits alongside them, are
documented in full in `docs/firmware/behavior.md`.

Two resilience behaviors are worth highlighting for a book chapter
specifically because they represent real engineering tradeoffs, not just
implementation detail: the offline reading ring-buffer (20 entries,
oldest overwritten first, flushed in order on reconnect) means a brief
network outage does not silently lose data, but a longer one does lose
whatever exceeds the buffer's capacity - a bounded, documented tradeoff
rather than an unbounded memory risk. And the remote `set_config` command
is authenticated only by virtue of arriving over an already-open
WebSocket connection - the firmware's own comments flag this as a
real hijack risk if the server doesn't gate connections by device token
at handshake time, which is exactly the kind of thing this book should
report honestly rather than omit.

## Outline

- Three configuration paths: captive portal, serial commands, remote
  `set_config`, and their respective use cases
- WiFi resilience: boot-retry counter (RTC memory) and mid-run
  exponential-backoff reconnect
- Offline reading buffer: what it protects against and its real capacity
  limit
- The remote-config security caveat, quoted directly from the firmware's
  own comments (see also Chapter 19,
  `docs/limitations/security-limitations.md` §6)
- The firmware's data contract (cross-reference, not redefinition -
  `docs/architecture/data-contract.md`)
