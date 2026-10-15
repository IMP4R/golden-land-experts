# Agent Note: Golden Land sidebar seats use the native details track

Status: implemented

English | [中文](2026-08-25-golden-land-sidebar-seats.zh.md)

## Problem

Golden Land needs permanent Projects and Design entries in the shipped Web UI. A floating overlay would cover the conversation, while replacing the layout or sidebar would duplicate native geometry, resize behavior, and slot ownership.

## Decision

`@deepseek-ai/dsh-client-ui-gl-seats` contributes one list entry to `sidebar.footer.action`. The entry renders the `Проекты` and `Дизайн` rows with the sidebar owner's `wide` state.

`Проекты` owns a root-scoped popover and reads the loopback Golden Land ledger service with XMLHttpRequest. It does not create a Harness slot or persist duplicate project state.

`Дизайн` opens the layout-owned details track. A child effect registers a `details` occupant at priority `-10`, shadowing the shipped conversation details occupant only while the panel is open. Disposing that effect restores the shipped occupant. `ctx.layout.openDetails()` and `closeDetails()` retain ownership of the track width, drag handle, and concession solver.

The Design row is disabled while the current session is blank because `details` has session scope. A current-session change closes Design before the new session renders.

## Alternatives considered

A fixed overlay was rejected because it would cover the conversation instead of participating in the layout width solve. Replacing `ui-layout` was rejected because it would duplicate panel geometry and sidebar behavior. A permanent `details` shadow was rejected because it would hide tool details while Design is closed. A new layout child slot was rejected because the registry's single-slot priority behavior already supports this temporary panel.

## Consequences

The plugin uses the native right column, drag resize, responsive width concessions, and teardown behavior without changing layout internals. Closing Design or unloading the package restores tool details. Design remains unavailable in a blank session, and both seats depend on the loopback ledger service for Golden Land data.

The assembled Web profile includes the package in `window.__DSH_BOOT__` and serves `/plugins/@deepseek-ai/dsh-client-ui-gl-seats/client.js`. Browser validation covers both rows, the projects popover, resize from 364px to 466px, restoration of the shipped Details panel, and absence of page and console errors.
