"""Configure the Todoist chore history integration in Home Assistant."""

import voluptuous as vol
from aiohttp import ClientError, ClientTimeout

from homeassistant.config_entries import ConfigFlow
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    EntitySelector,
    EntitySelectorConfig,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from . import API, DOMAIN, IDENTIFIER


class TodoistChoreHistoryConfigFlow(ConfigFlow, domain=DOMAIN):
    """Collect a Todoist token and the family chore project mappings."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        if self._async_current_entries():
            return self.async_abort(reason="already_configured")
        return await self._show_settings("user", user_input)

    async def async_step_reconfigure(self, user_input=None):
        return await self._show_settings(
            "reconfigure", user_input, self._get_reconfigure_entry()
        )

    async def _show_settings(self, step_id, user_input, entry=None):
        errors = {}
        legacy = self.hass.data.get(DOMAIN, {}).get("legacy") or {}
        existing = entry.data if entry else legacy
        defaults = {}
        for index, (entity, project) in enumerate(
            list(existing.get("projects", {}).items())[:4], 1
        ):
            defaults[f"entity_{index}"] = entity
            defaults[f"project_{index}"] = project

        if user_input is not None:
            defaults = {key: value for key, value in user_input.items() if key != "token"}
            token = user_input.get("token", "").strip() or existing.get("token")
            if not token:
                errors["token"] = "token_required"
            projects = {}
            for index in range(1, 5):
                entity = user_input.get(f"entity_{index}")
                project = user_input.get(f"project_{index}", "").strip()
                if not entity and not project:
                    continue
                if not entity or not project:
                    errors["base"] = "incomplete_mapping"
                    break
                if entity in projects:
                    errors[f"entity_{index}"] = "duplicate_entity"
                    break
                try:
                    projects[entity] = IDENTIFIER(project)
                except vol.Invalid:
                    errors[f"project_{index}"] = "invalid_project"
                    break
            if not errors and not projects:
                errors["base"] = "mapping_required"
            if not errors:
                errors = await self._validate(token, projects)
            if not errors:
                data = {"token": token, "projects": projects}
                if entry:
                    return self.async_update_reload_and_abort(entry, data=data)
                return self.async_create_entry(title="Todoist Chore History", data=data)

        schema = {
            vol.Optional("token"): TextSelector(
                TextSelectorConfig(type=TextSelectorType.PASSWORD)
            )
        }
        for index in range(1, 5):
            schema[vol.Optional(f"entity_{index}")] = EntitySelector(
                EntitySelectorConfig(domain="todo")
            )
            schema[vol.Optional(f"project_{index}")] = TextSelector()
        return self.async_show_form(
            step_id=step_id,
            data_schema=self.add_suggested_values_to_schema(vol.Schema(schema), defaults),
            errors=errors,
        )

    async def _validate(self, token, projects):
        session = async_get_clientsession(self.hass)
        try:
            for project in projects.values():
                async with session.get(
                    f"{API}/projects/{project}",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=ClientTimeout(total=10),
                    allow_redirects=False,
                ) as response:
                    if response.status == 401:
                        return {"token": "invalid_auth"}
                    if response.status in (403, 404):
                        return {"base": "project_unavailable"}
                    if response.status != 200:
                        return {"base": "cannot_connect"}
        except (ClientError, TimeoutError, ValueError):
            return {"base": "cannot_connect"}
        return {}
