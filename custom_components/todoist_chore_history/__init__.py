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
    settings = config.get(DOMAIN)
    hass.data[DOMAIN] = {"legacy": settings, "entry": None}
    await hass.http.async_register_static_paths([
        StaticPathConfig(
            "/todoist_chore_history/family-chore-columns.js",
            str(Path(__file__).with_name("family-chore-columns.js")),
            False,
        ),
        StaticPathConfig(
            "/todoist_chore_history/family-photo-wall.js",
            str(Path(__file__).with_name("family-photo-wall.js")),
            False,
        ),
    ])
    session = async_get_clientsession(hass)

    async def request(token, method, path, params=None):
        headers = {"Authorization": "Bearer " + token}
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
        runtime = hass.data[DOMAIN]
        settings = runtime["entry"] or runtime["legacy"]
        project = settings["projects"].get(entity) if settings else None
        if not project:
            raise HomeAssistantError("This chore list is not configured")
        now = datetime.now(timezone.utc)
        since = now - timedelta(hours=24)
        params = {"project_id": project, "since": since.isoformat(), "until": now.isoformat()}
        items = []
        cursors = set()
        while True:
            page = await request(settings["token"], "GET", "/tasks/completed/by_completion_date", params)
            items.extend(item for item in page["items"] if str(item.get("project_id")) == project)
            cursor = page.get("next_cursor")
            if not cursor:
                return items, settings["token"]
            if cursor in cursors:
                raise HomeAssistantError("Todoist returned a repeated page")
            cursors.add(cursor)
            params["cursor"] = cursor

    def local_date(value):
        return value.split("T")[0] if value else None

    async def get_recent(call):
        entity = call.data["entity_id"]
        items, token = await recent(entity)
        history = [{
            "uid": str(item["id"]),
            "summary": item["content"],
            "description": item.get("description") or "",
            "completedAt": item["completed_at"],
            "recurring": bool((item.get("due") or {}).get("is_recurring")),
            "dueDate": local_date((item.get("due") or {}).get("date")),
        } for item in items if item.get("completed_at")]

        runtime = hass.data[DOMAIN]
        project = (runtime["entry"] or runtime["legacy"])["projects"][entity]
        now = datetime.now(timezone.utc)
        since = now - timedelta(hours=24)
        params = {
            "parent_project_id": project,
            "object_type": "item",
            "event_type": "completed",
            "date_from": since.isoformat(),
            "date_to": now.isoformat(),
        }
        seen = {(item["uid"], datetime.fromisoformat(item["completedAt"])) for item in history}
        cursors = set()
        while True:
            page = await request(token, "GET", "/activities", params)
            for event in page["results"]:
                details = event.get("extra_data") or {}
                if not (details.get("is_recurring") or details.get("isRecurring")):
                    continue
                if str(event.get("parent_project_id")) != project or not details.get("content"):
                    continue
                uid = str(event["object_id"])
                completed_at = event["event_date"]
                timestamp = datetime.fromisoformat(completed_at)
                key = (uid, timestamp)
                if not since <= timestamp < now or key in seen:
                    continue
                seen.add(key)
                history.append({
                    "uid": uid,
                    "summary": details["content"],
                    "description": details.get("description") or "",
                    "completedAt": completed_at,
                    "recurring": True,
                    "dueDate": local_date(
                        details.get("completed_due_date_local")
                        or details.get("completedDueDateLocal")
                    ),
                })
            cursor = page.get("next_cursor")
            if not cursor:
                return {"items": history}
            if cursor in cursors:
                raise HomeAssistantError("Todoist returned a repeated activity page")
            cursors.add(cursor)
            params["cursor"] = cursor

    async def reopen(call):
        entity = call.data["entity_id"]
        uid = call.data["item"]
        items, token = await recent(entity)
        item = next((entry for entry in items if str(entry["id"]) == uid), None)
        if not item:
            raise HomeAssistantError("This completion is no longer in the last 24 hours")
        if (item.get("due") or {}).get("is_recurring"):
            raise HomeAssistantError("Reopen recurring occurrences in Todoist")
        await request(token, "POST", f"/tasks/{uid}/reopen")

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


async def async_setup_entry(hass, entry):
    hass.data[DOMAIN]["entry"] = entry.data
    return True


async def async_unload_entry(hass, entry):
    hass.data[DOMAIN]["entry"] = None
    return True
