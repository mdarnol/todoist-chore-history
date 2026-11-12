# Todoist Chore History

Home Assistant integration and dashboard card for per-project Todoist chores. Shows the rolling 24-hour completion history and can reopen any recently completed chore, recurring or not.

## Install

Add this repository to HACS as a custom repository of type **Integration** and download it. For manual installation, copy `custom_components/todoist_chore_history` into Home Assistant's configuration directory under `custom_components`.

Restart Home Assistant after installing. Open **Settings → Devices & services → Add integration** and search for **Todoist Chore History**. Paste a Todoist API token from an account that can access the chore projects. For each person, select their Home Assistant to-do list and enter the corresponding Todoist project ID. The form supports four mappings. To change a mapping or rotate the token later, use **Reconfigure** in the integration's menu.

An existing YAML setup keeps working. After verifying the web setup, you can remove the old integration block and its dedicated secret if nothing else uses it.

In **Settings → Dashboards → Resources**, register the following URLs as **JavaScript modules**, with `?v=` set to the version in `manifest.json` (prevents your browser from serving a stale cached copy after an update). If replacing an earlier version of a card, edit its existing resource instead of keeping two entries.

```text
/todoist_chore_history/family-chore-columns.js?v=0.2.13
/todoist_chore_history/family-photo-wall.js?v=0.2.13
```

Use one chore card per person's view. An optional `color` tints that person's Overdue and Today columns at 20% opacity:

```yaml
type: custom:family-chore-columns
entity: todo.example_chores
color: "#f9a8d4"
```

`family-photo-wall` is a photo screensaver card meant for a `wallpanel` overlay. It cycles random photos from an Immich album: a landscape photo shows full-screen, and a portrait photo is paired with another portrait photo side by side. Each photo gets its own location/date caption:

```yaml
type: custom:family-photo-wall
immich_url: https://immich.example.com/api
immich_api_key: your-immich-api-key
album_name: Family
display_time: 60
```

Verify that a known recent completion appears. Use a disposable non-recurring task to verify reopening. Home Assistant users with access to these services can view and reopen recent chores in the configured projects.

## Update

Download the newer version in HACS and restart Home Assistant. Bump the `?v=` on each registered resource URL to the new version and hard-refresh the dashboard (Ctrl+Shift+R) so it loads the bundled cards instead of a cached copy. Manual installs can update by replacing the entire integration folder before restarting.

