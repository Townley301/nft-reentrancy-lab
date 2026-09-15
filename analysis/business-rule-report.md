# 业务规则回调验证报告

- 规则文件：rules/callback-rules.json
- 规则摘要：fc3eac6c9cd26a7f
- 执行边界：Hardhat 临时内存链；无 RPC、钱包、私钥或真实资产
- 结果：14/14 个生成场景符合研究者预期

| 规则 | 模板 | 版本 | 参数 | 预期 | 观察 | 通过 |
|---|---|---|---|---|---|---|
| one-time-mint-right | one-time-mint | vulnerable | `{}` | violate | violate | 是 |
| one-time-mint-right | one-time-mint | fixed | `{}` | preserve | preserve | 是 |
| collateral-covers-debt | collateral-coverage | vulnerable | `{"borrowAmount":11}` | violate | violate | 是 |
| collateral-covers-debt | collateral-coverage | fixed | `{"borrowAmount":11}` | preserve | preserve | 是 |
| collateral-covers-debt | collateral-coverage | vulnerable | `{"borrowAmount":15}` | violate | violate | 是 |
| collateral-covers-debt | collateral-coverage | fixed | `{"borrowAmount":15}` | preserve | preserve | 是 |
| collateral-covers-debt | collateral-coverage | vulnerable | `{"borrowAmount":19}` | violate | violate | 是 |
| collateral-covers-debt | collateral-coverage | fixed | `{"borrowAmount":19}` | preserve | preserve | 是 |
| payout-within-funded-value | funded-value | vulnerable | `{"outerQuantity":3,"depositPerUnit":1,"additionalQuantity":1}` | violate | violate | 是 |
| payout-within-funded-value | funded-value | fixed | `{"outerQuantity":3,"depositPerUnit":1,"additionalQuantity":1}` | preserve | preserve | 是 |
| payout-within-funded-value | funded-value | vulnerable | `{"outerQuantity":5,"depositPerUnit":2,"additionalQuantity":2}` | violate | violate | 是 |
| payout-within-funded-value | funded-value | fixed | `{"outerQuantity":5,"depositPerUnit":2,"additionalQuantity":2}` | preserve | preserve | 是 |
| payout-within-funded-value | funded-value | vulnerable | `{"outerQuantity":8,"depositPerUnit":3,"additionalQuantity":2}` | violate | violate | 是 |
| payout-within-funded-value | funded-value | fixed | `{"outerQuantity":8,"depositPerUnit":3,"additionalQuantity":2}` | preserve | preserve | 是 |

## 观察证据

- **one-time-mint-right / vulnerable**：`{"finalNftBalance":2,"callbacks":2,"reentrySucceeded":true}`
- **one-time-mint-right / fixed**：`{"finalNftBalance":1,"callbacks":1,"reentrySucceeded":false}`
- **collateral-covers-debt / vulnerable**：`{"withdrawalRejected":false,"remainingCollateral":0,"remainingDebt":10,"callbacks":2}`
- **collateral-covers-debt / fixed**：`{"withdrawalRejected":true,"remainingCollateral":2,"remainingDebt":11,"callbacks":0}`
- **collateral-covers-debt / vulnerable**：`{"withdrawalRejected":false,"remainingCollateral":0,"remainingDebt":14,"callbacks":2}`
- **collateral-covers-debt / fixed**：`{"withdrawalRejected":true,"remainingCollateral":2,"remainingDebt":15,"callbacks":0}`
- **collateral-covers-debt / vulnerable**：`{"withdrawalRejected":false,"remainingCollateral":0,"remainingDebt":18,"callbacks":2}`
- **collateral-covers-debt / fixed**：`{"withdrawalRejected":true,"remainingCollateral":2,"remainingDebt":19,"callbacks":0}`
- **payout-within-funded-value / vulnerable**：`{"fundedValue":1,"finalBalance":4,"outerSeriesId":2,"callbackSeriesId":2}`
- **payout-within-funded-value / fixed**：`{"fundedValue":1,"finalBalance":1,"outerSeriesId":2,"callbackSeriesId":3}`
- **payout-within-funded-value / vulnerable**：`{"fundedValue":4,"finalBalance":14,"outerSeriesId":2,"callbackSeriesId":2}`
- **payout-within-funded-value / fixed**：`{"fundedValue":4,"finalBalance":4,"outerSeriesId":2,"callbackSeriesId":3}`
- **payout-within-funded-value / vulnerable**：`{"fundedValue":6,"finalBalance":30,"outerSeriesId":2,"callbackSeriesId":2}`
- **payout-within-funded-value / fixed**：`{"fundedValue":6,"finalBalance":6,"outerSeriesId":2,"callbackSeriesId":3}`
