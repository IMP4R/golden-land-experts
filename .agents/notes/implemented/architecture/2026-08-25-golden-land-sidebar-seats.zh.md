# Agent Note: Golden Land 侧边栏入口复用原生详情列

Status: implemented

[English](2026-08-25-golden-land-sidebar-seats.md) | 中文

## 问题

Golden Land 需要在发布的 Web UI 中永久提供“项目”和“设计”入口。浮动遮罩会覆盖会话内容，而替换布局或侧边栏会重复实现原生几何、拖动调整和插槽所有权。

## 决策

`@deepseek-ai/dsh-client-ui-gl-seats` 向 `sidebar.footer.action` 提供一个列表项。该项使用侧边栏所有者的 `wide` 状态渲染 `Проекты` 和 `Дизайн` 两行。

`Проекты` 拥有一个 root 作用域的弹出面板，并通过 XMLHttpRequest 读取本机 Golden Land ledger 服务。它不创建 Harness 插槽，也不保存重复的项目状态。

`Дизайн` 打开布局拥有的详情列。一个子 effect 以优先级 `-10` 注册 `details` 占用项，仅在面板打开期间遮蔽内置会话详情占用项。释放该 effect 后，内置占用项恢复。`ctx.layout.openDetails()` 与 `closeDetails()` 继续拥有列宽、拖动手柄和宽度让步算法。

当前会话为空时，`details` 的会话作用域使设计入口保持禁用。当前会话改变时，设计面板会在新会话渲染前关闭。

## 考虑过的替代方案

固定遮罩会覆盖会话，而不是参与布局宽度计算，因此被拒绝。替换 `ui-layout` 会重复面板几何和侧边栏行为，因此被拒绝。永久遮蔽 `details` 会在设计关闭时隐藏工具详情，因此被拒绝。新增布局子插槽没有必要，因为注册表的 single-slot 优先级已经支持这种临时面板。

## 后果

该插件无需修改布局内部实现即可复用原生右栏、拖动调整、响应式宽度让步和卸载行为。关闭设计或卸载包会恢复工具详情。设计在空会话中仍不可用，两个入口都依赖本机 ledger 服务提供 Golden Land 数据。

组装后的 Web profile 在 `window.__DSH_BOOT__` 中包含该包，并提供 `/plugins/@deepseek-ai/dsh-client-ui-gl-seats/client.js`。浏览器验证覆盖两个入口、项目弹出面板、从 364px 到 466px 的拖动调整、关闭后恢复内置 Details 面板，以及无页面或控制台错误。
