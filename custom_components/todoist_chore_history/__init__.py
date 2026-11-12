"""Expose a restricted Todoist chore completion history to Home Assistant."""
from datetime import datetime, timedelta, timezone

from pathlib import Path

import voluptuous as vol
from aiohttp import ClientError, ClientTimeout

from homeassistant.components.http import StaticPathConfig
from homeassistant.core import SupportsResponse
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession

DOMAIN = "todoist_chore_history"
API = "https://api.todoist.com/api/v1"
IDENTIFIER = vol.Match(r"^[A-Za-z0-9_-]+$")
CONFIG_SCHEMA = vol.Schema({
    DOMAIN: {
        vol.Required("token"): cv.string,
        vol.Required("projects"): {cv.entity_id: IDENTIFIER},
    },
}, extra=vol.ALLOW_EXTRA)


async def async_setup(hass, config):
    settings = config[DOMAIN]
    await hass.http.async_register_static_paths([
        StaticPathConfig(
            "/todoist_chore_history/family-chore-columns.js",
            str(Path(__file__).with_name("family-chore-columns.js")),
            False,
        ),
    ])
    session = async_get_clientsession(hass)
    headers = {"Authorization": "Bearer " + settings["token"]}

    async def request(method, path, params=None):
        try:
            async with session.request(
                method, API + path, headers=headers, params=params,
                timeout=ClientTimeout(total=15), allow_redirects=False,
            ) as response:
                if response.status >= 300:
                    raise HomeAssistantError(f"Todoist returned HTTP {response.status}")
                if method == "GET":
                    return await response.json()
        except (ClientError, TimeoutError, ValueError) as err:
            raise HomeAssistantError("Unable to read or update Todoist") from err

    async def recent(entity):
        project = settings["projects"].get(entity)
        if not project:
            raise HomeAssistantError("This chore list is not configured")
        now = datetime.now(timezone.utc)
        since = now - timedelta(hours=24)
        params = {"project_id": project, "since": since.isoformat(), "until": now.isoformat()}
        items = []
        cursors = set()
        while True:
            page = await request("GET", "/tasks/completed/by_completion_date", params)
            items.extend(item for item in page["items"] if str(item.get("project_id")) == project)
            cursor = page.get("next_cursor")
            if not cursor:
                return items
            if cursor in cursors:
                raise HomeAssistantError("Todoist returned a repeated page")
            cursors.add(cursor)
            params["cursor"] = cursor

    async def get_recent(call):
        items = await recent(call.data["entity_id"])
        return {"items": [{
            "uid": str(item["id"]),
            "summary": item["content"],
            "completedAt": item["completed_at"],
            "recurring": bool((item.get("due") or {}).get("is_recurring")),
        } for item in items if item.get("completed_at")]}

    async def reopen(call):
        entity = call.data["entity_id"]
        uid = call.data["item"]
        items = await recent(entity)
        item = next((entry for entry in items if str(entry["id"]) == uid), None)
        if not item:
            raise HomeAssistantError("This completion is no longer in the last 24 hours")
        if (item.get("due") or {}).get("is_recurring"):
            raise HomeAssistantError("Reopen recurring occurrences in Todoist")
        await request("POST", f"/tasks/{uid}/reopen")

    entity_schema = vol.Schema({vol.Required("entity_id"): cv.entity_id})
    hass.services.async_register(
        DOMAIN, "get_recent", get_recent, schema=entity_schema,
        supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN, "reopen", reopen,
        schema=entity_schema.extend({vol.Required("item"): IDENTIFIER}),
    )
    return True
