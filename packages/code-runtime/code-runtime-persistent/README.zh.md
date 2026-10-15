# Persistent Code Runtime（持久化代码运行时）

这是 CPython `ctx.codeRuntime` 实现。每个 agent session 保留一个解释器，因此连续的 Code Mode 程序可以复用 Python 变量。DSH 或运行时重启后，解释器全局变量不会保留；需跨重启恢复的数据应存入 durable history 或其他宿主存储。

## 配置

- `runTimeoutMs`：每个程序的正数墙钟超时，单位为毫秒，默认 120000。超时会终止解释器。

## 隔离与限制

内核子进程使用与 DSH 相同的系统权限；持久状态只是便利功能，不是安全边界。不同 session 使用不同内核。释放 provider 时会终止并等待所有内核退出。此后端声明 Python SDK 语言及 `persistent-process` substrate。

包默认导出 Service provider 类。应将其作为另一 `codeRuntime` provider 的替代项挂载，不能同时挂载多个 provider。

## 已知限制与延期工作

- session 变量只存在于运行中的解释器，运行时或 DSH 重启后会丢失。
- Python 代码以宿主用户权限执行；不要用此后端运行不受信任的程序。
