# Todoist Chore History

Home Assistant integration and dashboard card for per-project Todoist chores. Shows the rolling 24-hour completion history and can reopen completed non-recurring chores. Recurring completions appear as read-only entries.

## Install

Add this repository to HACS as a custom repository of type **Integration** and download it. For manual installation, copy `custom_components/todoist_chore_history` into Home Assistant's configuration directory under `custom_components`.

Configure a Todoist API token from an account with access to the listed projects. Store it in Home Assistant's `secrets.yaml` as `todoist_chore_history_token`.

Add this to `configuration.yaml`, using your actual Home Assistant to-do entity IDs and Todoist project IDs:

```yaml
todoist_chore_history:
  token: !secret todoist_chore_history_token
  projects:
    todo.example_chores: "YOUR_TODOIST_PROJECT_ID"
```

Validate the configuration and restart Home Assistant. In **Settings → Dashboards → Resources**, register the following URL as a **JavaScript module**. If replacing an earlier version of the card, edit its existing resource instead of keeping two entries.

```text
/todoist_chore_history/family-chore-columns.js
```

Use one card per person's view:

```yaml
type: custom:family-chore-columns
entity: todo.example_chores
```

Verify that a known recent completion appears. Use a disposable non-recurring task to verify reopening. Home Assistant users with access to these services can view and reopen recent chores in the configured projects.

## Update

Download the newer version in HACS and restart Home Assistant. Refresh the dashboard so it loads the bundled card. Manual installs can update by replacing the entire integration folder before restarting.

