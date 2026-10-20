# Track Record

A static website for tracking coaster rides and credits. The page layout is in `index.html`, interactive behavior is in `app.js`, and Firebase Authentication/Cloud Firestore provide private per-account sign-in and cross-device sync. There is no application server or build step. Relogging opens the entry editor without changing laps until saved: saving the same ride adds a lap, while changing the coaster name creates a separate log for that version. Deleting a logged coaster also removes its matching row from the currently loaded park search. Official Coaster Name offers the current ride name and names associated with a meaningful variation change; same-variation former names are offered under Coaster Name When Ridden. Coaster Name When Ridden and Park Name When Ridden are optional and blank for new search logs. Coaster search uses Coasterpedia's park-specific Past Names and history to default significant ride changes to Reimagined and former-park entries to Relocated; only Reimagined is shown as a search tag.

## Test locally

From this folder, start a local web server (Firebase modules require HTTP/HTTPS; opening `index.html` directly as a file will not work):

```powershell
py -m http.server 8000
```

Then open <http://localhost:8000> in your browser. Press `Ctrl+C` in the terminal to stop the server.

## Publish with GitHub Pages

1. Push this folder to a GitHub repository.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select your publishing branch and the `/(root)` folder, then save.
5. Open the website URL shown in the Pages settings once the deployment finishes.

The site entry point is `index.html`, so GitHub Pages serves it from the repository root along with `app.js` and `firebase-cloud.js`. A branded loading screen stays visible until Firebase restores the session and, for signed-in users, loads the account data, preventing temporary zero counters during reload. Visitors can browse park and coaster discovery as guests; each account's private credits are shown only after sign-in. Creating, editing, relogging, deleting, importing, exporting, or changing credit rules prompts guests to sign in. Park and coaster discovery uses Coasterpedia's public MediaWiki API, including all indexed parks with present or former coaster lists and documented former ride names. The park's current present/former lists determine which group a ride appears in; those groups can be collapsed. Coaster list rows show the ride class and let you log, edit, or relog an entry directly. Multi-track coasters (such as Gemini) are split into separate track entries. Park-specific names and former names come from Coasterpedia's Past Names information rather than page redirects, so a relocated coaster is displayed under its name at each park and treated as a separate relocated credit there. Name changes at the same park can still appear as previously known names when documented in the ride's name history. Coasterpedia dates are displayed as years to help distinguish same-name rides, and log entries from coaster search retain their Coasterpedia ride/track identity and operating years so they do not merge. When a park's coaster table identifies a ride as powered, alpine, or water, the quick-log form selects that ride type automatically; otherwise it uses Roller Coaster. Rides not listed in a park directory can be logged manually. The dashboard category cards filter the log and can be clicked again to clear the selected filter; the Parks card opens the park-and-coaster breakdown above the log. The Relogs card filters coaster entries with multiple recorded rides. Relogging adds a lap to the existing coaster entry rather than creating another credit; repeated matching entries are grouped in the dashboard, and the Duplicates card identifies relocated entries and same-name coasters at different parks or with distinct Coasterpedia identities at one park. The setting “Count relogs toward Total” controls whether repeated laps add to Total; it is off by default. Changing credit rules immediately recalculates the counters. Ride entries can mark the date and time as independently unknown; unknown date/time components are left blank in the log. Lap counts are shown only for multiple rides. On load, saved entries with a park are checked against Coasterpedia and matching ride statuses are updated; entries with no known park/list match retain their saved status. Entries can be edited, relogged, or deleted. Credit rules separately control powered, alpine, and water rides; meaningful Reimagined changes; and unchanged rides relocated to another park. Older saved credit settings and ride variation labels are migrated to the updated rule categories. Firebase web configuration is in `firebase-cloud.js`; `firestore.rules` restrict each authenticated account to its own profile and ride entries. Deploy those rules in the Firebase Console before allowing users to sign up. Existing browser-only logs are imported into the first Firebase account that signs in from that browser. Local per-user caches and JSON export remain available as backups. Styling and icons load from their respective CDNs.

## Firebase setup

1. In Firebase Authentication, enable **Email/Password**.
2. Create a Cloud Firestore database.
3. Publish the contents of `firestore.rules` in **Firestore Database → Rules**.
4. Add the deployed website domain (for example, `yourname.github.io`) under **Authentication → Settings → Authorized domains**. `localhost` is normally allowed for local testing.
5. Update the Firebase web configuration in `firebase-cloud.js` if deploying to a different Firebase project.
