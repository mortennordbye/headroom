# Changelog

## [3.10.1](https://github.com/mortennordbye/headroom/compare/v3.10.0...v3.10.1) (2026-10-31)


### Bug Fixes

* close gaps found in review of the mortgage and savings-rate changes ([#285](https://github.com/mortennordbye/headroom/issues/285)) ([f38805b](https://github.com/mortennordbye/headroom/commit/f38805bc8251ad7becf58099f3cde2b4c9273b2f))
* let undo work on mortgage edits saved before the balance moved to assets ([#287](https://github.com/mortennordbye/headroom/issues/287)) ([8352bc8](https://github.com/mortennordbye/headroom/commit/8352bc83f5404c24721632c7cd83da37e8fa0899))

## [3.10.0](https://github.com/mortennordbye/headroom/compare/v3.9.1...v3.10.0) (2026-10-31)


### Features

* show when market data was last imported on the Marked tab ([#282](https://github.com/mortennordbye/headroom/issues/282)) ([195f5e6](https://github.com/mortennordbye/headroom/commit/195f5e6c197dcc113588eaf3bedf5f69c55aa068))


### Bug Fixes

* count the principal part of loan payments as kept in the savings rate ([#284](https://github.com/mortennordbye/headroom/issues/284)) ([bf7cb44](https://github.com/mortennordbye/headroom/commit/bf7cb4416c3e1edaa886020da1bf1d1818def389))
* store the mortgage balance once, in assets.houseDebt ([#280](https://github.com/mortennordbye/headroom/issues/280)) ([ab6e9dc](https://github.com/mortennordbye/headroom/commit/ab6e9dce3125b133a88ca50ccf71434892b2b2c8)), closes [#279](https://github.com/mortennordbye/headroom/issues/279)

## [3.9.1](https://github.com/mortennordbye/headroom/compare/v3.9.0...v3.9.1) (2026-10-31)


### Bug Fixes

* correct labels, axes and defaults found in the calculation review ([#277](https://github.com/mortennordbye/headroom/issues/277)) ([a32ff86](https://github.com/mortennordbye/headroom/commit/a32ff86f80bbb2383c0a20e31df76a4afd456623))
* count holiday pay above salary in the Forecast, money flow and pension figures ([#274](https://github.com/mortennordbye/headroom/issues/274)) ([574f46f](https://github.com/mortennordbye/headroom/commit/574f46ff63c20985443d631d3cae2ca75e874630))
* skip overlap rows re-imported after a re-link changes the reference format ([#273](https://github.com/mortennordbye/headroom/issues/273)) ([cfca20a](https://github.com/mortennordbye/headroom/commit/cfca20ad974e3d921c9f4b0a38b74688c18c8579))
* warn about job overlaps in any month and when every salaried job has ended ([#275](https://github.com/mortennordbye/headroom/issues/275)) ([b1eaaca](https://github.com/mortennordbye/headroom/commit/b1eaacaa79f854651b1969cabd93a28a11e0d6fa))

## [3.9.0](https://github.com/mortennordbye/headroom/compare/v3.8.2...v3.9.0) (2026-10-31)


### Features

* opt-in housing market data with a comparable-sales home valuation ([#265](https://github.com/mortennordbye/headroom/issues/265)) ([6676fae](https://github.com/mortennordbye/headroom/commit/6676fae26f2de41c7c7ac2fd350e0a537e9cbaa4))


### Bug Fixes

* **deps:** bump the npm-minor-patch group with 5 updates ([#269](https://github.com/mortennordbye/headroom/issues/269)) ([e042e9b](https://github.com/mortennordbye/headroom/commit/e042e9ba7005617b932c49e79dbc0369c365542b))

## [3.8.2](https://github.com/mortennordbye/headroom/compare/v3.8.1...v3.8.2) (2026-10-30)


### Bug Fixes

* anchor the mortgage paydown plan at the first owner-mode month ([#261](https://github.com/mortennordbye/headroom/issues/261)) ([529e211](https://github.com/mortennordbye/headroom/commit/529e2117edc337b93ff4178d5312f49daffa630a))
* **bsu:** say that lifetime room is measured against the balance ([#247](https://github.com/mortennordbye/headroom/issues/247)) ([c656495](https://github.com/mortennordbye/headroom/commit/c6564959628da98616728a4f951365f541556ebd))
* **employer-cost:** cap the employer pension at 12G ([#253](https://github.com/mortennordbye/headroom/issues/253)) ([3fe0b4d](https://github.com/mortennordbye/headroom/commit/3fe0b4db844328886e66b5ebac4f2764210f1100))
* **employer-cost:** count only holiday pay above ferietrekk as extra cost ([#243](https://github.com/mortennordbye/headroom/issues/243)) ([51c5a6c](https://github.com/mortennordbye/headroom/commit/51c5a6cc575566113c2d07080befd2d322468b34))
* end the seed's net-worth history at the computed net worth ([#263](https://github.com/mortennordbye/headroom/issues/263)) ([91398c2](https://github.com/mortennordbye/headroom/commit/91398c280963ae25c34f409eb847bac1d22e28db))
* **forecast:** amortise home debt at the Dashboard's rate and term ([#251](https://github.com/mortennordbye/headroom/issues/251)) ([f395d1d](https://github.com/mortennordbye/headroom/commit/f395d1d80bc5d4e49e94b0670cfdbdc3e4af1070))
* **forecast:** make prepay vs invest agree between the page and MCP ([#248](https://github.com/mortennordbye/headroom/issues/248)) ([13f4a4d](https://github.com/mortennordbye/headroom/commit/13f4a4ded25fc6cc1c2a5125b7bc1171fb4e1914))
* **forecast:** project home equity and non-mortgage debt like the dashboard ([#245](https://github.com/mortennordbye/headroom/issues/245)) ([e96487d](https://github.com/mortennordbye/headroom/commit/e96487da059e84e0a0cd6fdff1deb86024d54e70))
* **forecast:** tax prepay-vs-invest gains once on sale, not yearly ([#252](https://github.com/mortennordbye/headroom/issues/252)) ([a68cb4f](https://github.com/mortennordbye/headroom/commit/a68cb4fe7826d5b95bf28d5c074a733b1b9a835f))
* **income:** derive gross from net income when there are no salaries ([#246](https://github.com/mortennordbye/headroom/issues/246)) ([1e76da1](https://github.com/mortennordbye/headroom/commit/1e76da1c451909267e3d74b7ad59083e6d1d42ee))
* **mcp:** report pension income in today's kroner, as the Pension page ([#255](https://github.com/mortennordbye/headroom/issues/255)) ([bf6be7f](https://github.com/mortennordbye/headroom/commit/bf6be7f08c20d71e1c3ecd677f18774df5ff672b))
* never let the mortgage placeholder overwrite a real balance ([#260](https://github.com/mortennordbye/headroom/issues/260)) ([8af59ce](https://github.com/mortennordbye/headroom/commit/8af59ce0d5a7000554173807ef9562f2f9ccb737))
* one transition loan need and one rentefradrag base across app and MCP ([#262](https://github.com/mortennordbye/headroom/issues/262)) ([4ddf11e](https://github.com/mortennordbye/headroom/commit/4ddf11e7ca8ed2ae239ad123619b4c6b60fe3dcd))
* **pension:** cap the OTP contribution base at 12G ([#240](https://github.com/mortennordbye/headroom/issues/240)) ([9bd72e3](https://github.com/mortennordbye/headroom/commit/9bd72e32d8177fe89bdf8914cec5139602a5554b))
* **pension:** show retirement income in today's kroner throughout ([#244](https://github.com/mortennordbye/headroom/issues/244)) ([b7addee](https://github.com/mortennordbye/headroom/commit/b7addee54c9c5ccbe074736c587653e61917aca8))
* read the current mortgage through one resolver in every projection ([#258](https://github.com/mortennordbye/headroom/issues/258)) ([a3901b6](https://github.com/mortennordbye/headroom/commit/a3901b61e6ae170288e05d3011a5cbde420d8315))
* reconcile the three mortgage balances on load and on a mode switch ([#257](https://github.com/mortennordbye/headroom/issues/257)) ([24ce1f7](https://github.com/mortennordbye/headroom/commit/24ce1f7c85b2e4561f6c19a0a36d2daa6f3a7ca2))
* **salary:** narrow the job-change rule and guard gross-from-net at 100 % ([#254](https://github.com/mortennordbye/headroom/issues/254)) ([49e3f2c](https://github.com/mortennordbye/headroom/commit/49e3f2c038ff5205399755716621a144bcfd23e8))
* **salary:** stop counting both jobs in the month of a job change ([#239](https://github.com/mortennordbye/headroom/issues/239)) ([9f3969c](https://github.com/mortennordbye/headroom/commit/9f3969ce62636e169fd681c38a30f813fd9d9b4a))
* show and edit the current loan's rate and term while transitioning ([#259](https://github.com/mortennordbye/headroom/issues/259)) ([231fad5](https://github.com/mortennordbye/headroom/commit/231fad53dffa6b5c9976578d06a8b7d6e80c5f08))
* **tax:** deduct mortgage interest only on a loan the user owes ([#242](https://github.com/mortennordbye/headroom/issues/242)) ([0e86eb5](https://github.com/mortennordbye/headroom/commit/0e86eb529e54d5c63aba6da147809a2d3a49ff98))
* **tax:** use the revised 2026 pension income tax credit ([#241](https://github.com/mortennordbye/headroom/issues/241)) ([7b5cc8e](https://github.com/mortennordbye/headroom/commit/7b5cc8e998115c2c9696012e96053c6919e4a8dc))

## [3.8.1](https://github.com/mortennordbye/headroom/compare/v3.8.0...v3.8.1) (2026-10-29)


### Bug Fixes

* **bank:** keep an account's key when a re-link issues a new uid ([#236](https://github.com/mortennordbye/headroom/issues/236)) ([3320159](https://github.com/mortennordbye/headroom/commit/332015961b0a215dcf987c29647d3dd194e5dbc4))

## [3.8.0](https://github.com/mortennordbye/headroom/compare/v3.7.0...v3.8.0) (2026-10-29)


### Features

* **bolig:** co-owners with ownership and loan share ([#220](https://github.com/mortennordbye/headroom/issues/220)) ([3f7b178](https://github.com/mortennordbye/headroom/commit/3f7b178f3eb6fe6300461680505a1657771b7419))
* **budget:** mark a single transaction as a transfer or a one-off ([#230](https://github.com/mortennordbye/headroom/issues/230)) ([8b4ed08](https://github.com/mortennordbye/headroom/commit/8b4ed08d7ca91ef41103bb1b83e185009e11a14d))
* **salary:** skattekort with monthly withholding and budget income ([#232](https://github.com/mortennordbye/headroom/issues/232)) ([bc07710](https://github.com/mortennordbye/headroom/commit/bc0771055a18dd6aac7617a4e9ed3c294c93a85b))


### Bug Fixes

* **automation:** charge a loan's monthly interest once across rules ([#226](https://github.com/mortennordbye/headroom/issues/226)) ([f2ba047](https://github.com/mortennordbye/headroom/commit/f2ba047691f0b0545a785337ab1fa557a58c285c))
* **bolig:** co-owner review fixes ([#223](https://github.com/mortennordbye/headroom/issues/223)) ([37b5fb5](https://github.com/mortennordbye/headroom/commit/37b5fb5df7ece03854aa69115ae0941f63d59b39))
* **categorize:** re-label Vipps rows the old vipps keyword filed as transfers ([#227](https://github.com/mortennordbye/headroom/issues/227)) ([22aa913](https://github.com/mortennordbye/headroom/commit/22aa91337b7321ee6228b295e058385518fe602d))
* **tax:** count holiday pay above salary as taxed income ([#234](https://github.com/mortennordbye/headroom/issues/234)) ([9181ccd](https://github.com/mortennordbye/headroom/commit/9181ccda997b0004462dc68bfac96fc45207ece6))
* **tax:** use the 2026 wealth tax figures ([#229](https://github.com/mortennordbye/headroom/issues/229)) ([abb580d](https://github.com/mortennordbye/headroom/commit/abb580d3cc65cfab70f4a9d3774e641080cf49a1))
* **ui:** let a modal taller than the window scroll ([#233](https://github.com/mortennordbye/headroom/issues/233)) ([505e603](https://github.com/mortennordbye/headroom/commit/505e603ec872ecc5537edc333a76a06a31cbe56a))

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
