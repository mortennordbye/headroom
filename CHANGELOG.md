# Changelog

## [3.17.0](https://github.com/mortennordbye/headroom/compare/v3.16.1...v3.17.0) (2026-11-01)


### Features

* treat payments to the user's own account numbers as internal transfers ([#358](https://github.com/mortennordbye/headroom/issues/358)) ([c6d0740](https://github.com/mortennordbye/headroom/commit/c6d0740a8e5bca453607745427c4262511ae5e07))


### Bug Fixes

* project a linked debt at the payment its fixed expense makes ([#357](https://github.com/mortennordbye/headroom/issues/357)) ([f4846ae](https://github.com/mortennordbye/headroom/commit/f4846ae9b47624191ccf0afc2d1c1d0b93b22021))

## [3.16.1](https://github.com/mortennordbye/headroom/compare/v3.16.0...v3.16.1) (2026-11-01)


### Bug Fixes

* grow a debt the payment can't keep up with in net-worth projections ([#355](https://github.com/mortennordbye/headroom/issues/355)) ([824f980](https://github.com/mortennordbye/headroom/commit/824f9806eaedb590fb574ddd651efe4c43b6b85f))
* let the OTP base include bonuses when the scheme counts them ([#353](https://github.com/mortennordbye/headroom/issues/353)) ([a45086f](https://github.com/mortennordbye/headroom/commit/a45086f407f1f3edb0a843900ab05ac52bfc3709))

## [3.16.0](https://github.com/mortennordbye/headroom/compare/v3.15.0...v3.16.0) (2026-11-01)


### Features

* show the scenario band on the Assets and Dashboard projections ([#352](https://github.com/mortennordbye/headroom/issues/352)) ([f7bf073](https://github.com/mortennordbye/headroom/commit/f7bf0736b4f26b48035f7ad5eb07c64f44b13039))


### Bug Fixes

* step loan catch-ups month by month and keep a departed paydown's charged months ([#350](https://github.com/mortennordbye/headroom/issues/350)) ([a1e19c2](https://github.com/mortennordbye/headroom/commit/a1e19c2ff133da4cec690052df1c94b287437021))

## [3.15.0](https://github.com/mortennordbye/headroom/compare/v3.14.2...v3.15.0) (2026-11-01)


### Features

* tell savings rows apart and show the destination balance ([#346](https://github.com/mortennordbye/headroom/issues/346)) ([894eb70](https://github.com/mortennordbye/headroom/commit/894eb709396970bfe980e3ce708cf74f8ba863bc))


### Bug Fixes

* record bank sync only for connections it fully fetched, one sync at a time ([#349](https://github.com/mortennordbye/headroom/issues/349)) ([88c9d1a](https://github.com/mortennordbye/headroom/commit/88c9d1ac81c8670ad5c9019f5f0d78fa216d51a8))
* show savings as their own series in the cashflow chart ([#351](https://github.com/mortennordbye/headroom/issues/351)) ([2819d1c](https://github.com/mortennordbye/headroom/commit/2819d1c703c3e7cab59c457a8258c31d940a8ea1))

## [3.14.2](https://github.com/mortennordbye/headroom/compare/v3.14.1...v3.14.2) (2026-11-01)


### Bug Fixes

* charge interest for months a paydown's stamp never paid ([#344](https://github.com/mortennordbye/headroom/issues/344)) ([8d778fc](https://github.com/mortennordbye/headroom/commit/8d778fcbfb3040911971516b7de0874d69c6d0a3))

## [3.14.1](https://github.com/mortennordbye/headroom/compare/v3.14.0...v3.14.1) (2026-11-01)


### Bug Fixes

* close the co-owner gaps in catch-ups, buy-and-sell and onboarding ([#340](https://github.com/mortennordbye/headroom/issues/340)) ([10b586a](https://github.com/mortennordbye/headroom/commit/10b586af30b6ecdd40d32b70bbdd0fa32698086d))
* count a co-owned home at its market share in gjeldsreduksjon ([#343](https://github.com/mortennordbye/headroom/issues/343)) ([a37c67e](https://github.com/mortennordbye/headroom/commit/a37c67eba7617f97ea4ddc5a8e167e9c973f99a0))

## [3.14.0](https://github.com/mortennordbye/headroom/compare/v3.13.0...v3.14.0) (2026-11-01)


### Features

* sync allocation-made transfers to the edited split ([#333](https://github.com/mortennordbye/headroom/issues/333)) ([bd32332](https://github.com/mortennordbye/headroom/commit/bd3233202c20f6770610e0cad20012147f97a563))


### Bug Fixes

* charge interest for months a declined catch-up skipped ([#338](https://github.com/mortennordbye/headroom/issues/338)) ([6684d50](https://github.com/mortennordbye/headroom/commit/6684d506c49770a8ba64df28183b9a20d91391f3))

## [3.13.0](https://github.com/mortennordbye/headroom/compare/v3.12.1...v3.13.0) (2026-11-01)


### Features

* count BSU lifetime room against total deposited ([#334](https://github.com/mortennordbye/headroom/issues/334)) ([ddad8e9](https://github.com/mortennordbye/headroom/commit/ddad8e90eed8d38b9b39017b08eb0ca3b5b73fac))


### Bug Fixes

* let the history grid open a month's editor ([#335](https://github.com/mortennordbye/headroom/issues/335)) ([daea8ae](https://github.com/mortennordbye/headroom/commit/daea8aee2c6d9028ef23e6b5b7792b9d6e91b1f3))
* read an eb-&lt;8hex&gt;- id as connection-prefixed only for a known connection ([#337](https://github.com/mortennordbye/headroom/issues/337)) ([2395807](https://github.com/mortennordbye/headroom/commit/2395807d95aa2beabd3501fc325756bfc155c357))
* use Oslo time for the current month on the server and MCP, and decouple the Assets saving plan ([#332](https://github.com/mortennordbye/headroom/issues/332)) ([92480e4](https://github.com/mortennordbye/headroom/commit/92480e49b58aa8abff6c075ee3217c76ec50df72))

## [3.12.1](https://github.com/mortennordbye/headroom/compare/v3.12.0...v3.12.1) (2026-11-01)


### Bug Fixes

* charge each cashflow and year review month its own savings ([#328](https://github.com/mortennordbye/headroom/issues/328)) ([c5b7831](https://github.com/mortennordbye/headroom/commit/c5b7831116d4540fe9f2f18dafe08b4199749476))
* keep a v1 month's assumptions unrecorded when editing its balances ([#330](https://github.com/mortennordbye/headroom/issues/330)) ([6f96651](https://github.com/mortennordbye/headroom/commit/6f9665123a7a501cd22b5b5cb9069a1fd3be520d))
* show the viewed month's assumptions on the asset rate chips ([#329](https://github.com/mortennordbye/headroom/issues/329)) ([756ae58](https://github.com/mortennordbye/headroom/commit/756ae581cea484bcf4268cd33bdf458e3a82caeb))

## [3.12.0](https://github.com/mortennordbye/headroom/compare/v3.11.0...v3.12.0) (2026-11-01)


### Features

* label assets projection when a past month recorded no assumptions ([#323](https://github.com/mortennordbye/headroom/issues/323)) ([2c73521](https://github.com/mortennordbye/headroom/commit/2c735218f13104dffb367ed495180c7af1da9e74))
* re-categorize auto-labelled transactions from Settings ([#324](https://github.com/mortennordbye/headroom/issues/324)) ([4d5344f](https://github.com/mortennordbye/headroom/commit/4d5344f48bf0f9580e634460434d7aeeb68ad19e))


### Bug Fixes

* correct three calculation edge cases found in the module audit ([#321](https://github.com/mortennordbye/headroom/issues/321)) ([9eaf0ef](https://github.com/mortennordbye/headroom/commit/9eaf0efbf33a3268fb58455c8b8592ad43430296))
* keep a deleted bank row deleted across a re-link ([#316](https://github.com/mortennordbye/headroom/issues/316)) ([abcec11](https://github.com/mortennordbye/headroom/commit/abcec112fe48490690d86517a4e0ca9e8e2abeba))

## [3.11.0](https://github.com/mortennordbye/headroom/compare/v3.10.8...v3.11.0) (2026-11-01)


### Features

* flag a monthly income override that no longer matches salary ([#319](https://github.com/mortennordbye/headroom/issues/319)) ([a15a05c](https://github.com/mortennordbye/headroom/commit/a15a05cfa1d8ca2b708ef925ebc7eb59f654acdb))
* move all unassigned salary entries to a job in one step ([#313](https://github.com/mortennordbye/headroom/issues/313)) ([0483f8b](https://github.com/mortennordbye/headroom/commit/0483f8b7fde67bc9c6f12de7f5bb723ec7fbf6e9))


### Bug Fixes

* apply a notified mortgage rate once its month arrives ([#311](https://github.com/mortennordbye/headroom/issues/311)) ([4fcdccb](https://github.com/mortennordbye/headroom/commit/4fcdccbd13ab517b952cb08b2349b7f3aee6826d))
* apply gjeldsreduksjon to wealth tax debt ([#320](https://github.com/mortennordbye/headroom/issues/320)) ([51c5a52](https://github.com/mortennordbye/headroom/commit/51c5a523ed69e62ee1b3ea3d09d5013729b772ff))
* rate-limit the public demo per client IP ([#317](https://github.com/mortennordbye/headroom/issues/317)) ([ca66e9c](https://github.com/mortennordbye/headroom/commit/ca66e9cffa25fa4ca23876c6403a5f12425ff3d6))
* reconcile each year review month against its own fixed expenses ([#315](https://github.com/mortennordbye/headroom/issues/315)) ([e57b609](https://github.com/mortennordbye/headroom/commit/e57b609fa51b60181167a20e582b9dd562561c7b))
* undo compares legacy mortgage history as the app showed it ([#314](https://github.com/mortennordbye/headroom/issues/314)) ([59816ba](https://github.com/mortennordbye/headroom/commit/59816ba283cdcb7fb827499796144cc07fe4172b))


### Performance Improvements

* store revision snapshot sizes instead of measuring them on every save ([#312](https://github.com/mortennordbye/headroom/issues/312)) ([cc0c1be](https://github.com/mortennordbye/headroom/commit/cc0c1be82f84f579432a67509082a603c940a11c))

## [3.10.8](https://github.com/mortennordbye/headroom/compare/v3.10.7...v3.10.8) (2026-11-01)


### Bug Fixes

* close mortgage edge cases from old or hand-made data ([#309](https://github.com/mortennordbye/headroom/issues/309)) ([c507a39](https://github.com/mortennordbye/headroom/commit/c507a392a726f6124052a3ea53232ec3e3992215))
* measure last month's spend against that month's fixed expenses ([#306](https://github.com/mortennordbye/headroom/issues/306)) ([5d7ebb2](https://github.com/mortennordbye/headroom/commit/5d7ebb23257645e485916b7c80d5c8a07c83b67a))
* reconcile each cashflow chart month against its own fixed expenses ([#310](https://github.com/mortennordbye/headroom/issues/310)) ([9e66679](https://github.com/mortennordbye/headroom/commit/9e666794bab3f9082473c3291b916fa281d326ae))
* serve the SPA fallback when the install path has a dot-directory ([#308](https://github.com/mortennordbye/headroom/issues/308)) ([5e9582d](https://github.com/mortennordbye/headroom/commit/5e9582de85c81b23bb631f83b44ced3f1b440e7b))

## [3.10.7](https://github.com/mortennordbye/headroom/compare/v3.10.6...v3.10.7) (2026-11-01)


### Bug Fixes

* recover taps that iOS never turns into a click, for every button ([#303](https://github.com/mortennordbye/headroom/issues/303)) ([879167a](https://github.com/mortennordbye/headroom/commit/879167a59cf52e33e93c640d1b0ef1ecfb807422))
* smooth page switches: no skeleton flash, scroll to top, fade in ([#305](https://github.com/mortennordbye/headroom/issues/305)) ([8b92057](https://github.com/mortennordbye/headroom/commit/8b920576939db6a34a90371b3421d255a7718525))

## [3.10.6](https://github.com/mortennordbye/headroom/compare/v3.10.5...v3.10.6) (2026-11-01)


### Bug Fixes

* navigate mobile tabs on lift-off, since iOS can drop the click ([#300](https://github.com/mortennordbye/headroom/issues/300)) ([6962b15](https://github.com/mortennordbye/headroom/commit/6962b15b67697bb96b4ba7796bda46d1d2ca9fb3))
* open the More sheet and act on its buttons on touch end ([#302](https://github.com/mortennordbye/headroom/issues/302)) ([756175f](https://github.com/mortennordbye/headroom/commit/756175f4915b2f07f995ce39e26d31ec87ccf17f))

## [3.10.5](https://github.com/mortennordbye/headroom/compare/v3.10.4...v3.10.5) (2026-11-01)


### Bug Fixes

* add a Settings switch for the tap log ([#299](https://github.com/mortennordbye/headroom/issues/299)) ([bc57867](https://github.com/mortennordbye/headroom/commit/bc578677c9c2f97b7da1a1d4ef5e1d9c50087c58))
* keep toasts off the mobile tab bar and add a tap log for the first-tap bug ([#297](https://github.com/mortennordbye/headroom/issues/297)) ([13e7daf](https://github.com/mortennordbye/headroom/commit/13e7daf7f8523d87890bde4cc02185bb9fcbd826))

## [3.10.4](https://github.com/mortennordbye/headroom/compare/v3.10.3...v3.10.4) (2026-11-01)


### Bug Fixes

* show the loading skeleton on the first tap to a page that isn't loaded ([#295](https://github.com/mortennordbye/headroom/issues/295)) ([8ee616e](https://github.com/mortennordbye/headroom/commit/8ee616e2eb4b31480bb24e06308a668601165fdd))

## [3.10.3](https://github.com/mortennordbye/headroom/compare/v3.10.2...v3.10.3) (2026-10-31)


### Bug Fixes

* make the whole mobile tab bar tappable and its icons brass ([#293](https://github.com/mortennordbye/headroom/issues/293)) ([aed7bee](https://github.com/mortennordbye/headroom/commit/aed7bee781443c779468e115e2485a32f4362d21))

## [3.10.2](https://github.com/mortennordbye/headroom/compare/v3.10.1...v3.10.2) (2026-10-31)


### Bug Fixes

* make mobile tab switches respond on the first tap ([#292](https://github.com/mortennordbye/headroom/issues/292)) ([b8bb273](https://github.com/mortennordbye/headroom/commit/b8bb273219807757d80528b5c3b8cda185bdcde2))
* refuse undo it can't express, read text balances, and tighten tests ([#290](https://github.com/mortennordbye/headroom/issues/290)) ([4a17acc](https://github.com/mortennordbye/headroom/commit/4a17accece432eb829feb6789bbb9042170ed674))

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
