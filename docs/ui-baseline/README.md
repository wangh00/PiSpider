# UI 截图基线

这组图片是设置页“外观主题”卡片的视觉基线，由真实 `tokens.css`、`panel.css`、`theme.js` 和 `theme-card.js` 渲染，不启动完整桌面，也不读写用户配置。

生成：

```powershell
cd apps/pispider-desktop
npm run ui:baseline
```

脚本会：

- 以 1060px 和 360px 两种宽度渲染内置 / 自定义主题卡片；
- 断言无横向溢出、卡片尺寸有效、色块数量与主题数据一致；
- 覆盖内置亮 / 暗、自定义亮 / 暗和窄宽五个场景；
- 写入本目录的 PNG 与 `report.json`。

当前场景：

| 文件 | 场景 |
| --- | --- |
| `theme-card-builtin-light.png` | 内置黑白主题，亮色 |
| `theme-card-builtin-dark.png` | 内置黑白主题，暗色 |
| `theme-card-custom-light.png` | 测试灰绿主题，亮色 |
| `theme-card-custom-dark.png` | 测试灰绿主题，暗色 |
| `theme-card-custom-narrow.png` | 测试灰绿主题，暗色，360px 窄宽 |

`report.json` 记录每张图的卡片尺寸、色块数量、主题名和视口宽度。修改主题卡样式或 `theme-card.js` 后重新生成，人工比对差异后再提交基线。
