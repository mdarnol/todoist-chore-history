# Todoist Chore History

Home Assistant integration and dashboard card for per-project Todoist chores. Shows the rolling 24-hour completion history and can reopen any recently completed chore, recurring or not.

## Install

Add this repository to HACS as a custom repository of type **Integration** and download it. For manual installation, copy `custom_components/todoist_chore_history` into Home Assistant's configuration directory under `custom_components`.

Restart Home Assistant after installing. Open **Settings → Devices & services → Add integration** and search for **Todoist Chore History**. Paste a Todoist API token from an account that can access the chore projects. For each person, select their Home Assistant to-do list and enter the corresponding Todoist project ID. The form supports four mappings. To change a mapping or rotate the token later, use **Reconfigure** in the integration's menu.

An existing YAML setup keeps working. After verifying the web setup, you can remove the old integration block and its dedicated secret if nothing else uses it.

In **Settings → Dashboards → Resources**, register the following URL as a **JavaScript module**, with `?v=` set to the version in `manifest.json` (prevents your browser from serving a stale cached copy after an update). If replacing an earlier version of the card, edit its existing resource instead of keeping two entries.

```text
/todoist_chore_history/family-chore-columns.js?v=0.2.5
```

Use one card per person's view:

```yaml
type: custom:family-chore-columns
entity: todo.example_chores
```

Verify that a known recent completion appears. Use a disposable non-recurring task to verify reopening. Home Assistant users with access to these services can view and reopen recent chores in the configured projects.

## Update

Download the newer version in HACS and restart Home Assistant. Bump the `?v=` on the registered resource URL to the new version and hard-refresh the dashboard (Ctrl+Shift+R) so it loads the bundled card instead of a cached copy. Manual installs can update by replacing the entire integration folder before restarting.

