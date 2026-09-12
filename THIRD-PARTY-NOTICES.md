# 第三方声明

本仓库分发以下第三方作品，特此声明其来源与许可。

## Superpowers

- 来源：<https://github.com/obra/superpowers>
- 版本：v6.1.1（commit `d884ae04edebef577e82ff7c4e143debd0bbec99`，2026-07-02）
- 许可：MIT，Copyright (c) 2025 Jesse Vincent
- 范围：`preset/skills/**` 为上游 `skills/**` 的副本

`preset/skills/**` 与上游的差异**仅两处**（其余逐字节一致），两者都是 DSH 移植所需的本地改动，而非内容改写：

1. `preset/skills/using-superpowers/references/dsh-tools.md` —— 新增文件，DSH 工具映射（88 行）；
2. `preset/skills/using-superpowers/SKILL.md` 第 59 行 —— 新增一行 Platform Adaptation 指针：
   `- DeepSeek Harness: \`references/dsh-tools.md\``

### 上游许可全文

```
MIT License

Copyright (c) 2025 Jesse Vincent

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
