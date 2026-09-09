# Roadmap

Where Vitrine is, where it's going, and what it deliberately won't become.

## What Vitrine is for

**One photographer, their own gallery, on their own terms.**

The target is someone who wants their work presented well and owned outright, without learning to run a server to get it. So two goals that pull against each other, held together on purpose:

- **Little computer knowledge to start.** Set three variables, run one command, and you have a gallery.
- **A great deal of control if you want it.** Presentation, metadata, visibility, image pipeline, ordering — configurable to the point of fussiness, for people who know exactly what they want.

Neither goal is allowed to eat the other. Defaults exist so nobody _has_ to configure anything; nothing is hidden so that people who care can't reach it.

For the working list of what to pick up next, see [TODO](TODO.md).

## Where it is today

Early development. It works end to end and it has been run in anger by exactly one person, its author. Back up `DATA_DIR` and expect rough edges.

| Area                                            | State                                                       |
| ----------------------------------------------- | ----------------------------------------------------------- |
| Sign-in, sessions, visibility, passworded links | ✅ Solid                                                    |
| Public pages, stacks, collection grid           | ✅ Solid                                                    |
| Photo viewer — keys, filmstrip, zoom, details   | ✅ Solid                                                    |
| Downloads, collection ZIP, metadata control     | ✅ Solid                                                    |
| Capture-date ordering, sitemap, link previews   | ✅ Solid                                                    |
| Stack → grid transition, 3D hover               | ✅ Solid — see the note on browser extensions below         |
| Uploading                                       | ⚠️ Works, not production ready — needs failure handling     |
| Collection and photo management                 | ⚠️ Works, not production ready — thin and awkward in places |
| Reordering photographs within a collection      | ✅ Drag to arrange                                          |
| Reordering collections themselves               | ⬜ "Custom order" exists in the database, no interface yet  |
| Object storage (S3 / R2)                        | ⬜ Planned                                                  |
| Video                                           | ⬜ Planned                                                  |
| Watermarking                                    | ⬜ Planned                                                  |
| Collaborator accounts                           | ⬜ Considering                                              |
| Open multi-tenant hosting                       | ❌ Not planned — see below                                  |

### A note on browser extensions

A gallery is an unusually hostile page for extensions that attach to images, and there is nothing on these pages but images. One measured at 150–300ms of JavaScript per photograph, which is enough to make the motion stutter whenever images load. If Vitrine feels rough, check an incognito window before believing it is Vitrine. See [configuration → troubleshooting](CONFIGURATION.md#troubleshooting).

## Planned

### A second way to install

Docker is the only path today, and it still assumes you have somewhere to run it. The intent is a cloud-hosted option with **object storage (S3 or Cloudflare R2)** for originals and renditions, so a photographer with no server and no interest in acquiring one can still have a gallery.

That means storage has to stop being a filesystem path and start being an interface. `DATA_DIR` is currently the whole backup surface, which is a genuine virtue of the current design — the replacement has to keep "your work is yours, and you can take it with you" true.

### Video

Alongside photographs, in the same collections. The processing queue already survives crashes and resumes at startup, which is the part that matters most when a job takes minutes rather than seconds.

### Automatic watermarking

Applied at rendition time, so the original on disk stays clean and the watermark is a property of what's served. Optional, per collection.

### Download protection

For artists who want it. Worth being honest about the ceiling: **a browser cannot display an image without the viewer being able to keep it.** Screenshots exist, and the decoded bitmap is always reachable.

What is achievable is raising the cost and closing the careless paths — never serving the original, watermarking what is served, capping rendition size, disabling the obvious right-click route. What is not achievable is stopping a determined person, and the documentation will say so rather than implying a guarantee it can't keep.

## Considering

**Collaborator accounts.** Not a hosting platform — a second login for a specific, trusted person:

- A small group of artists working together on one gallery, each with their own sign-in
- A friend or an admin helping with setup and upkeep, without sharing the owner's password

The database already carries `owner_id` throughout, so this is closer to a routing and permissions question than a migration. What it needs is a clear answer to "who can do what", and that deserves designing rather than accreting.

## Not planned

**Open multi-tenant hosting.** Vitrine is not going to become a platform where strangers sign up and create accounts on someone else's install.

This is the sort of thing an artist hosts for themselves. That assumption is load-bearing: it's why there's no billing, no quotas, no per-tenant isolation, no abuse handling, no moderation — and why the whole gallery can be one Node process and one SQLite file you back up by copying a folder. Every one of those absences is a feature paid for by not being a platform.

Collaborator logins for people you know are a different thing, and are on the table.
