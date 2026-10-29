# Changelog

## [3.7.0](https://github.com/mortennordbye/headroom/compare/v3.6.0...v3.7.0) (2026-10-29)


### Features

* **bolig:** remaining term in years and months that counts down ([#218](https://github.com/mortennordbye/headroom/issues/218)) ([8f075fe](https://github.com/mortennordbye/headroom/commit/8f075feb14475595dbf9cdeb4da1f2ff623dc2c8))
* **employer-cost:** estimate employer profit and fair salary from the billed rate ([#198](https://github.com/mortennordbye/headroom/issues/198)) ([6e2907f](https://github.com/mortennordbye/headroom/commit/6e2907f01b8196286735a01d6667ab7d00a7b3e3))
* **employer-cost:** one calculator for salary, rate and margin ([#199](https://github.com/mortennordbye/headroom/issues/199)) ([72b7054](https://github.com/mortennordbye/headroom/commit/72b7054162aa0cd40ce59825585396682d091544))
* **history:** attribute revisions and undo a single change ([#208](https://github.com/mortennordbye/headroom/issues/208)) ([5508fe3](https://github.com/mortennordbye/headroom/commit/5508fe3fb87e6756c8e7e817377ed3a5f9ee42fd))
* let one month save less than the plan ([#167](https://github.com/mortennordbye/headroom/issues/167)) ([79a9856](https://github.com/mortennordbye/headroom/commit/79a985619816bf59647accbfab370798c2bacf31))
* make a saving its own record, not a fixed expense ([#130](https://github.com/mortennordbye/headroom/issues/130)) ([cb6f036](https://github.com/mortennordbye/headroom/commit/cb6f036e9478be8e3e3411faf546daca885e5816))
* **mcp:** salary, tax, pension, forecast, housing and transaction reads ([#207](https://github.com/mortennordbye/headroom/issues/207)) ([368f49a](https://github.com/mortennordbye/headroom/commit/368f49adb18f4887efb979e55ddfd9837708188e))
* **mcp:** typed writes for transactions, rules, balances and income ([#206](https://github.com/mortennordbye/headroom/issues/206)) ([a1ecc89](https://github.com/mortennordbye/headroom/commit/a1ecc89c6270bd4cdbf5cab8185f9ed77985e56d))
* **nav:** brass section icons on the top and mobile nav ([#211](https://github.com/mortennordbye/headroom/issues/211)) ([ba8251d](https://github.com/mortennordbye/headroom/commit/ba8251dccfc441469a57b76382cf7aa7b3a404af))
* **payslip:** derive Tripletex holiday pay for the period ([#195](https://github.com/mortennordbye/headroom/issues/195)) ([002fb8a](https://github.com/mortennordbye/headroom/commit/002fb8a70f319fe88e57c9bb3e92c7800ea6bbac))
* **payslip:** import Tripletex payslips ([#193](https://github.com/mortennordbye/headroom/issues/193)) ([9f579b5](https://github.com/mortennordbye/headroom/commit/9f579b504a98e1f7beb17965573d391569f58437))


### Bug Fixes

* charge imported fixed-expense payments once in year in review ([#192](https://github.com/mortennordbye/headroom/issues/192)) ([60b50b5](https://github.com/mortennordbye/headroom/commit/60b50b596f14af4301fff9e265e1f5e3d491bdc1)), closes [#190](https://github.com/mortennordbye/headroom/issues/190)
* clean up three issues found testing the release ([#213](https://github.com/mortennordbye/headroom/issues/213)) ([c7305df](https://github.com/mortennordbye/headroom/commit/c7305df78cc4a8b1cb53ab2572ea25e9f7f33e28))
* **history:** don't tag ordinary saves as imports after demo mode ([#209](https://github.com/mortennordbye/headroom/issues/209)) ([0f49d14](https://github.com/mortennordbye/headroom/commit/0f49d14b3af2e9a01c21ce39e39bc8d8d0768916))
* **mcp:** sync pension birth year and accept every app category ([#210](https://github.com/mortennordbye/headroom/issues/210)) ([f38605d](https://github.com/mortennordbye/headroom/commit/f38605d1a4a0fab58de20e41480259ed5118fc17))
* **pension:** show retirement income in today's kroner too ([#212](https://github.com/mortennordbye/headroom/issues/212)) ([113e6b7](https://github.com/mortennordbye/headroom/commit/113e6b78db860ddddb65377f0ef08b9c1000bc85))
* print the backup path that was actually written ([#143](https://github.com/mortennordbye/headroom/issues/143)) ([58e6219](https://github.com/mortennordbye/headroom/commit/58e6219424d667afa6e09ae3772d40af8005742a))

## [3.6.0](https://github.com/mortennordbye/headroom/compare/v3.5.0...v3.6.0) (2026-08-13)


### Features

* size a saving as an amount, a share or the rest ([#128](https://github.com/mortennordbye/headroom/issues/128)) ([13f7baf](https://github.com/mortennordbye/headroom/commit/13f7baf3470796366d180bf92c9fd5ff3b91b5eb))

## [3.5.0](https://github.com/mortennordbye/headroom/compare/v3.4.0...v3.5.0) (2026-08-12)


### Features

* **desktop:** check for a new release on launch ([b5acb82](https://github.com/mortennordbye/headroom/commit/b5acb8264a1005b3071e82954cf74edfa03b550e))
* project future months on the balance pages ([#123](https://github.com/mortennordbye/headroom/issues/123)) ([776f586](https://github.com/mortennordbye/headroom/commit/776f586358c092b067d1b950a5d1b3e913010915))
* prompt for the unrealized gain after a portfolio contribution ([#127](https://github.com/mortennordbye/headroom/issues/127)) ([57a62a4](https://github.com/mortennordbye/headroom/commit/57a62a47bd6f1ec54af366e2d4db8da2f796cba9))
* show the debt card on recorded and projected months, persist the growth toggle ([#125](https://github.com/mortennordbye/headroom/issues/125)) ([9dc907c](https://github.com/mortennordbye/headroom/commit/9dc907c008c27fb693e12e93cdda8efa41611bbe))
* shrink the Annet pile in transaction categorization ([#126](https://github.com/mortennordbye/headroom/issues/126)) ([d1ea4ac](https://github.com/mortennordbye/headroom/commit/d1ea4ac24b4c6f213551e571a7a1d472aa4c3b67))
* split the savings target with a "rest" row, over the whole target ([#121](https://github.com/mortennordbye/headroom/issues/121)) ([1a1da42](https://github.com/mortennordbye/headroom/commit/1a1da42017008dd06a17f419d5633eecd0d956f9))

## [3.4.0](https://github.com/mortennordbye/headroom/compare/v3.3.0...v3.4.0) (2026-08-10)


### Features

* make saving follow income and report it as saving everywhere ([#119](https://github.com/mortennordbye/headroom/issues/119)) ([0849f1a](https://github.com/mortennordbye/headroom/commit/0849f1ac19c98064f50d2fa3f48aa18531d3f343))

## [3.3.0](https://github.com/mortennordbye/headroom/compare/v3.2.0...v3.3.0) (2026-08-08)


### Features

* model saving as its own type instead of a fixed expense ([#114](https://github.com/mortennordbye/headroom/issues/114)) ([ca76b8e](https://github.com/mortennordbye/headroom/commit/ca76b8ebbc5769a0170c11aefa1750ee8dc63d77))

## [3.2.0](https://github.com/mortennordbye/headroom/compare/v3.1.0...v3.2.0) (2026-08-08)


### Features

* keep balances current with opt-in monthly automations ([#112](https://github.com/mortennordbye/headroom/issues/112)) ([2c0caac](https://github.com/mortennordbye/headroom/commit/2c0caac2b5633f22f0e762a19a57ac6767e46fb2))

## [3.1.0](https://github.com/mortennordbye/headroom/compare/v3.0.0...v3.1.0) (2026-08-07)


### Features

* ship Headroom as a Mac and Windows app, released automatically ([#104](https://github.com/mortennordbye/headroom/issues/104)) ([463e808](https://github.com/mortennordbye/headroom/commit/463e80854570cdd22bd65d57bd5ab16f135eb104))
