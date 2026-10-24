/**
 * English UI dictionary — the source of truth. Every other locale is typed
 * `satisfies Dict` against `typeof en`, so a missing or extra key fails
 * typecheck (and the unit parity test catches empty strings).
 *
 * Scope: public pages + auth chrome only. Card/set NAMES stay English (they
 * come from the Pokémon TCG API); this dictionary is the surrounding UI.
 *
 * Strings with a `{placeholder}` are fed through interpolate() (see ../t.ts).
 * Rich text is split into part-keys (…Pre/…Accent/…Post) — no markup parser.
 */

export const en = {
  common: {
    home: "Home",
    previous: "← Previous",
    next: "Next →",
    pageOf: "Page {page} of {pageCount}",
    pageShort: "Page {page} / {pageCount}",
    apply: "Apply",
    noImage: "No image",
    any: "Any",
    signIn: "Sign in",
  },

  layout: {
    skipToContent: "Skip to content",
    homeAria: "Pokector home",
    navMain: "Main",
    menu: "Menu",
    navCards: "Cards",
    navSets: "Sets",
    navPriceMovers: "Price movers",
    navPokedex: "Pokédex",
    navPricing: "Pricing",
    navBlog: "Blog",
    upgradeToPro: "Upgrade to Pro",
    proBadge: "Pro",
    searchCards: "Search cards",
    searchCardsPlaceholder: "Name, number, set…",
    searchResults: "Search results",
    searchViewAll: "See all results →",
    searchNoResults: "No matching cards",
    myCollection: "My collection",
    signIn: "Sign in",
    getStarted: "Get started",
    footerExplore: "Explore",
    footerCollectors: "For collectors",
    footerGrading: "Grading calculator",
    footerResources: "Resources",
    footerAbout: "About",
    footerMethodology: "Data & methodology",
    footerBlog: "Blog",
    footerContact: "Contact",
    footerPrivacy: "Privacy",
    footerTerms: "Terms",
    footerDisclaimer: "Disclaimer",
    footerRss: "RSS",
    languageLabel: "Language",
    marketLabel: "Price market",
    gameLabel: "Game",
    marketUs: "US region",
    marketEu: "EU region",
    disclaimer:
      "Pokector is an independent collection tracker and is not affiliated with, endorsed by, sponsored by, or officially connected to Nintendo, The Pokémon Company, Game Freak, Creatures, TCGplayer, Cardmarket, or the Pokémon TCG API. Pokémon and Pokémon character names are trademarks of Nintendo. Card images and catalog data are provided by their respective sources. Displayed prices are estimates for raw (ungraded) cards and are not financial advice.",
  },

  home: {
    metaTitle: "Pokector — Pokémon TCG Collection Tracker & Card Price Portfolio",
    metaDescription:
      "Track your Pokémon TCG collection, monitor estimated market value with TCGplayer prices, complete set checklists, organize binders, and watch your portfolio over time. Free and independent.",
    heroTitlePre: "Track every card",
    heroTitleAccent: "like an asset",
    heroSubtitle:
      "Your Pokémon TCG collection as a portfolio: live TCGplayer market values, real price history, profit & loss — honest numbers, no hype.",
    introSeo:
      "Pokector is a free collection tracker and price tracker built for Pokémon card collectors. Log the cards you own, follow live TCGplayer and Cardmarket values, complete set checklists, organize binders, and watch your portfolio's real profit and loss over time — no hype, just honest numbers.",
    heroSearchLabel: "Search the card catalog",
    heroSearchPlaceholder: "Search for a card, e.g. Charizard…",
    heroSearchButton: "Search",
    ctaStartTracking: "Start tracking free",
    ctaBrowseCards: "Browse cards",
    tickerAria: "Biggest 7-day price moves",
    tickerAllMovers: "All movers →",
    featuresHeading: "Built for collectors, not speculators",
    feature1Title: "Know what your collection is worth",
    feature1Body:
      "Every card you track is valued with current TCGplayer market estimates in USD (Cardmarket EUR shown alongside where available). Coverage is always transparent — unpriced cards are labeled, never counted as zero.",
    feature2Title: "Watch value over time",
    feature2Body:
      "Pokector records real price observations from the day you start tracking and builds your portfolio history from them. No backfilled or invented data — your chart starts when you do.",
    feature3Title: "Complete your sets",
    feature3Body:
      "Automatic checklists show what you own, what's missing, and roughly what the missing cards would cost — for every set in the catalog.",
    feature4Title: "Organize like a binder",
    feature4Body:
      "Arrange your cards into visual 9-pocket binder pages, keep binders private, or share them with a link.",
    latestSetsHeading: "Latest sets",
    popularPokemonHeading: "Popular Pokémon",
    fullPokedex: "Full Pokédex",
    allSets: "All sets →",
    cardsCount: "{count} cards",
    noImage: "No image",
    setsEmpty: "The catalog is being synchronized. Check back shortly.",
    recentCardsHeading: "Recently updated cards",
    recentCardsEmpty: "Card data will appear here after the first catalog synchronization.",
    valuationHeading: "How valuation works",
    valuation1Lead: "Market-based estimates.",
    valuation1Body:
      " Card values use current TCGplayer prices (market price where available, otherwise mid or low) per printing variant — normal, holofoil, reverse holofoil, and first edition.",
    valuation2Lead: "Raw cards only.",
    valuation2Body:
      " Estimates describe ungraded, near-mint-market pricing. Your card's actual condition may change what it would really sell for — condition is tracked, but never silently changes the estimate.",
    valuation3Lead: "Honest history.",
    valuation3Body:
      " Price history starts when Pokector first observes a card, and portfolio history starts when you do. Missing prices are shown as missing — never as zero. ",
    valuationReadMethodology: "Read the full methodology",
    finalCtaHeading: "Ready to see what your binder is worth?",
    finalCtaBody:
      "Create a free account, add your first cards in minutes, and let Pokector keep score from here on.",
    finalCtaButton: "Create free account",
  },

  collectorsLanding: {
    metaTitle: "Pokémon Card Collectors — Free Collection & Price Tracker | Pokector",
    metaDescription:
      "The free toolkit for Pokémon card collectors: track your collection, follow live TCGplayer & Cardmarket prices, complete set checklists, calculate grading ROI, and see real profit & loss.",
    breadcrumb: "For collectors",
    h1: "The toolkit for Pokémon card collectors",
    intro:
      "Pokector is a free, independent web app for Pokémon card collectors and investors. Track everything you own, follow real TCGplayer and Cardmarket prices, complete your sets, and watch your portfolio's honest profit and loss over time — no hype, no invented values.",
    browseCards: "Browse the catalog",
    toolsHeading: "Everything a collector needs in one place",
    tool1Title: "Collection tracker",
    tool1Body:
      "Log every card you own with its variant, condition, and what you paid. Your collection is valued with live market estimates and updates as prices move.",
    tool2Title: "Price & value tracker",
    tool2Body:
      "Follow real price history per card and variant, spot the biggest 7-day movers, and see where the market is heading before you buy or sell.",
    tool3Title: "Set checklists",
    tool3Body:
      "Automatic checklists for every set show what you own, what's missing, and roughly what completing the set would cost.",
    tool4Title: "Grading ROI calculator",
    tool4Body:
      "Compare a raw card's value against PSA 9 and PSA 10 sales, minus grading fees and shipping, to see whether grading is actually worth it.",
    tool5Title: "Card comparison",
    tool5Body:
      "Put cards side by side to compare prices and price history — handy when deciding which card to add next.",
    tool6Title: "Binders & wishlists",
    tool6Body:
      "Arrange your cards into visual 9-pocket binder pages, share them with a link, and set target prices on cards you still want.",
    toolCta: "Open",
    whyHeading: "Built for collectors, not speculators",
    whyBody:
      "Every price shows its source and date. Unpriced cards say “unpriced”, not “$0”. Price history starts when Pokector first observes a card, and your portfolio history starts the day you do — so the numbers you see are real, not backfilled.",
    faqHeading: "Frequently asked questions",
    faq1Q: "Is Pokector free for collectors?",
    faq1A: "Yes. Creating an account and tracking your collection is completely free.",
    faq2Q: "Where do the card prices come from?",
    faq2A:
      "Raw card values use current TCGplayer prices (USD), with Cardmarket (EUR) shown where available. PSA 9 and PSA 10 graded values come from recent sales. Every price shows its source and date.",
    faq3Q: "Can I track the value of my collection over time?",
    faq3A:
      "Yes. Pokector records real price observations and builds your portfolio history from the day you start tracking — including profit and loss versus what you paid.",
    faq4Q: "Does Pokector help me complete my sets?",
    faq4A:
      "Every set has an automatic checklist showing what you own, what's missing, and the estimated cost to finish it.",
    faq5Q: "Is Pokector official or affiliated with Pokémon?",
    faq5A:
      "No. Pokector is an independent project and is not affiliated with, endorsed by, or sponsored by Nintendo, The Pokémon Company, or Wizards of the Coast.",
    ctaHeading: "Start tracking your collection today",
    ctaBody: "Create a free account, add your first cards in minutes, and let Pokector keep score.",
    ctaButton: "Create free account",
  },

  gradingLanding: {
    metaTitle: "Pokémon Card Grading Calculator — Is PSA Worth It? | Pokector",
    metaDescription:
      "Free Pokémon card grading calculator: compare a raw card's value to PSA 9 and PSA 10 prices, subtract grading fees and shipping, and see whether grading is worth it.",
    breadcrumb: "Grading calculator",
    h1: "Pokémon card grading calculator",
    intro:
      "Should you grade that card? Enter what your raw card is worth and the going PSA 9 and PSA 10 prices, and this calculator subtracts grading fees and shipping to show your real return before you send anything to PSA.",
    tierLabel: "PSA tier",
    tierValue: "Value",
    tierRegular: "Regular",
    tierExpress: "Express",
    rawLabel: "Raw value ($)",
    psa9Label: "PSA 9 ($)",
    psa10Label: "PSA 10 ($)",
    colGrade: "Grade",
    colGradedValue: "Graded value",
    colAllIn: "All-in cost",
    colNet: "Net",
    colRoi: "ROI",
    feeNote: "PSA fee {fee} + shipping {shipping} (estimate — check PSA's current pricing).",
    disclaimer:
      "Estimate only. Not every card earns a PSA 10, and fees change — enter the numbers you'll actually pay.",
    howHeading: "How the grading ROI works",
    how1Lead: "Raw value in.",
    how1Body:
      " Start with what the ungraded card sells for today — your cost basis if you already own it, or the price to buy one.",
    how2Lead: "Graded value out.",
    how2Body:
      " PSA 9 and PSA 10 copies usually sell for a multiple of the raw price. The gap is your potential upside — but only part of it is profit.",
    how3Lead: "Fees and odds.",
    how3Body:
      " Grading isn't free: PSA charges per card plus return shipping, and not every card grades a 10. Factor both in before deciding.",
    tryHeading: "Try it on a real card",
    tryBody:
      "The live calculator runs on every card page that has both a raw price and recent PSA sales, using real market numbers. Open any card to see its grading ROI.",
    tryCta: "Browse cards",
    faqHeading: "Grading FAQ",
    faq1Q: "Is grading Pokémon cards worth it?",
    faq1A:
      "It depends on the card. Grading pays off when the PSA 9/10 price minus grading fees and shipping clearly beats the raw value — usually on expensive or near-mint cards. On cheap cards the fees eat the upside.",
    faq2Q: "How much does PSA grading cost?",
    faq2A:
      "PSA charges a per-card fee that varies by service tier and declared value, plus return shipping. Always check PSA's current pricing; this calculator lets you enter the fee you'll actually pay.",
    faq3Q: "What's the difference between PSA 9 and PSA 10?",
    faq3A:
      "PSA 10 (Gem Mint) is nearly flawless and usually sells for far more than PSA 9 (Mint). Because most cards don't earn a 10, the calculator lets you compare both outcomes.",
    faq4Q: "Does Pokector show real PSA prices?",
    faq4A:
      "On card pages with recent graded sales data, yes — PSA 9 and PSA 10 values are shown alongside the raw price so the calculator uses real numbers.",
    ctaHeading: "See grading ROI on your cards",
    ctaBody:
      "Create a free account to track your collection and see grading returns on every card you own.",
    ctaButton: "Create free account",
  },

  pricing: {
    metaTitle: "Pokector Pro — Pricing | Pokémon Collection Tracker",
    metaDescription:
      "Track your whole Pokémon card collection free. Upgrade to Pokector Pro for unlimited binders, wishlist, price alerts, graded cards, pinned sets, and your full portfolio history.",
    h1: "Pokector Pro",
    subtitle:
      "Track your whole collection for free. Go Pro for depth: unlimited everything, plus your complete portfolio value history.",
    billingInterval: "Billing interval",
    billingMonthly: "Monthly",
    billingYearly: "Yearly",
    saveNote: "save 16%",
    perMonth: "/mo",
    billedYearlyNote: "billed yearly",
    billedMonthlyNote: "billed monthly",
    freeName: "Free",
    proName: "Pro",
    freeTagline: "Everything you need to start collecting",
    proTagline: "For serious collectors & investors",
    priceFree: "$0",
    ctaFree: "Get started free",
    ctaPro: "Go Pro",
    ctaSignIn: "Create an account first",
    ctaCurrent: "Your current plan",
    ctaManage: "Manage subscription",
    comparisonHeading: "Compare plans",
    colFeature: "Feature",
    valUnlimited: "Unlimited",
    featCollection: "Track your whole collection",
    featBinders: "Binders",
    featWishlist: "Wishlist items",
    featAlerts: "Price alerts",
    featGraded: "Graded (PSA) cards",
    featPinned: "Pinned sets",
    featChecklists: "Set checklists & cost to completion",
    featExport: "CSV & JSON export",
    featGrading: "Grading ROI calculator",
    featPnl: "Realized & unrealized P/L",
    featBadge: "Premium badge",
    honestNote:
      "No feature you have today is taken away. Prices always show their source and date — unpriced cards say “unpriced”, never “$0”.",
    faqHeading: "Pricing FAQ",
    faq1Q: "Is the free plan really enough?",
    faq1A:
      "Yes. You can track your entire collection, complete sets, see values and P/L, and use the grading calculator for free. Pro adds scale (unlimited binders, alerts, graded cards…) and your full portfolio history.",
    faq2Q: "Can I cancel anytime?",
    faq2A:
      "Yes. Manage or cancel in one click via the secure Stripe customer portal. You keep Pro until the end of the period you already paid for.",
    faq3Q: "What happens to my data if I downgrade?",
    faq3A:
      "Nothing is ever deleted. If you go over a free limit you simply can't add more of that item until you're back under it — everything you already have stays visible.",
  },

  cards: {
    metaTitle: "Pokémon Card Catalog{suffix} | Pokector",
    metaTitleSuffix: " — Page {page}",
    metaDescription:
      "Browse and search the complete English Pokémon TCG card catalog with current estimated market prices, rarities, sets, and variants.",
    collectionName: "Pokémon Card Catalog",
    collectionDescription: "Complete English Pokémon TCG card catalog with market price estimates.",
    breadcrumb: "Cards",
    heading: "Pokémon card catalog",
    searchLabel: "Search",
    searchPlaceholder: "Card name, set, or number…",
    rarityLabel: "Rarity",
    setLabel: "Set",
    cardTypeLabel: "Card type",
    typePokemon: "Pokémon",
    typeTrainer: "Trainer",
    typeEnergy: "Energy",
    sortLabel: "Sort by",
    sortName: "Name",
    sortNumber: "Set number",
    sortNewest: "Recently updated",
    resultCount: "{count} cards",
    resultCountMatching: "{count} cards matching “{q}” · page {page} of {pageCount}",
    resultCountPlain: "{count} cards · page {page} of {pageCount}",
    emptyTitle: "No cards found",
    emptyBody:
      "Try a shorter search term, or check the spelling. The catalog covers English-language Pokémon TCG cards.",
    didYouMean: "Did you mean…",
    ownedBadgeAria: "You own {count} of this card",
    paginationAria: "Pagination",
  },

  cardDetail: {
    notFoundTitle: "Card not found | Pokector",
    notFoundDescription: "Card not found.",
    metaTitle: "{name} — {setName} #{number} Price & Details | Pokector",
    metaDescription:
      "{name} ({setName} #{number}{rarityPart}){pricePart}. Variants, price history, and collection tracking on Pokector.",
    metaRarityPart: ", {rarity}",
    metaPricePart: " — current estimated market price {price}",
    breadcrumbCards: "Cards",
    factCardType: "Card type",
    factSubtypes: "Subtypes",
    factEnergyType: "Energy type",
    factHp: "HP",
    factArtist: "Artist",
    factSetReleased: "Set released",
    factRegulationMark: "Regulation mark",
    pricesHeading: "Current market prices ({currency})",
    colTrend: "Trend",
    colAvgSell: "Avg. sell",
    sourceCardmarket: "Source: Cardmarket price data",
    tcgplayerPrice: "TCGplayer (USD): {price}",
    psaGlobalUsdNote: "PSA prices are the global graded market (eBay US), shown in USD.",
    pricesEmpty:
      "No market price is currently available for this card. It stays unpriced — Pokector never substitutes a guess.",
    colVariant: "Variant",
    colMarket: "Market est.",
    colLow: "Low",
    colMid: "Mid",
    colHigh: "High",
    sourceTcgplayer: "Source: TCGplayer price data",
    sourceUpdated: ", updated {date}",
    trackedSince: " Pokector has tracked this card since {date}.",
    trackingStarts: " Pokector price tracking starts with the first observation.",
    viewOnTcgplayer: "View on TCGplayer ↗",
    cardmarketTrend: "Cardmarket (EUR): {price} trend",
    viewOnCardmarket: "View on Cardmarket ↗",
    addToCollection: "Add to collection",
    addToWishlist: "Add to wishlist",
    compareCard: "Compare",
    ownedBadge: "In your collection: ×{count}",
    ownedVariants: " ({variants})",
    onWishlistBadge: "On your wishlist",
    manageInCollection: "Manage in collection ↗",
    addRequiresAccount: "Sign in to track this card in your collection or wishlist.",
    priceDisclaimer:
      "Displayed values are estimated market prices for raw (ungraded) cards and may not reflect the exact value of your copy, which depends on its physical condition and actual sale conditions. This is not financial advice.",
    getThisCard: "Get this card",
    buyOnEbay: "Buy on eBay",
    buyFrom: "from {price}",
    ebayFrom: "eBay: from {price}",
    ebayPsa9From: "PSA 9: from {price}",
    ebayPsa10From: "PSA 10: from {price}",
    psaFromEbay:
      "PSA prices are the median of current eBay asking prices (US), outliers trimmed — a rough guide, not completed sales.",
    psaSoldMedian: "PSA prices are the median of real eBay sales (last 90 days).",
    psaSampleCount: "· {count} sold",
    psaSampleListings: "· {count} listings",
    ebayDisclosure:
      "“Buy on eBay” is an affiliate link — Pokector may earn a commission from qualifying purchases, at no extra cost to you.",
    historyVariantAria: "Price history variant",
    historyTitle: "Price history — {variant}",
    historyEmpty:
      "No price history yet. Pokector records real observations only — tracking begins once this card is in a collection, wishlist, or viewed regularly.",
    historyStartNote:
      "Tracking since {date}. Values between observations carry the last known price forward.",
    relatedHeading: "More from {setName}",
    allSpeciesCards: "All {name} cards",
    variantNormal: "Normal",
    variantHolofoil: "Holofoil",
    variantReverseHolofoil: "Reverse Holofoil",
    variantFirstEdition: "1st Edition",
    variantFirstEditionHolofoil: "1st Edition Holofoil",
    gradingHeading: "Is it worth grading?",
    gradingTierLabel: "PSA service",
    gradingTierValue: "Value",
    gradingTierRegular: "Regular",
    gradingTierExpress: "Express",
    gradingRawCostLabel: "Your raw card cost (USD)",
    gradingColGrade: "Grade",
    gradingColGradedValue: "Graded value",
    gradingColAllIn: "All-in cost",
    gradingColNet: "Net",
    gradingColRoi: "ROI",
    gradingWorthIt: "Clears break-even",
    gradingNotWorth: "Below break-even",
    gradingSoldNote:
      "Graded values are the median of real eBay sales (last 90 days). PSA fees and shipping are estimates and vary by declared value and turnaround.",
    gradingListingDisclaimer:
      "Graded values are the median of current eBay asking prices (outliers trimmed), not completed sales — treat this as a rough guide only.",
    gradingFeeNote: "PSA fee {fee} + est. shipping {shipping}.",
  },

  sets: {
    metaTitle: "Pokémon TCG Sets{suffix} | Pokector",
    metaTitleSuffix: " — Page {page}",
    metaDescription:
      "All English Pokémon TCG expansions with release dates, card counts, and set symbols — from Base Set to the newest series.",
    collectionName: "Pokémon TCG Sets",
    collectionDescription: "All English Pokémon TCG expansions.",
    breadcrumb: "Sets",
    heading: "Pokémon TCG sets",
    seriesLabel: "Series",
    seriesAll: "All series",
    sortLabel: "Sort by",
    sortRelease: "Release date (newest)",
    sortName: "Name",
    sortCards: "Number of cards",
    resultCount: "{count} sets · page {page} of {pageCount}",
    empty: "The set catalog is being synchronized — check back shortly.",
    unknownRelease: "Unknown release",
    cardsCount: "{count} cards",
    printedSuffix: " ({count} printed)",
    paginationAria: "Pagination",
  },

  setDetail: {
    notFoundTitle: "Set not found | Pokector",
    notFoundDescription: "Set not found.",
    metaTitle: "{name} — Card List, Prices & Set Value | Pokector",
    metaDescription:
      "{name} ({series}{released}) — complete card list with {total} cards, market price estimates, and collection checklist on Pokector.",
    metaReleased: ", released {date}",
    metaAllCards: "all",
    breadcrumbSets: "Sets",
    released: " · Released {date}",
    cardsCount: " · {count} cards",
    printedSuffix: " ({count} in printed set numbering)",
    estimatedValuePre: "Estimated full-set market value: ",
    estimatedValueNote: "(sum of cheapest priced variant for {priced} of {total} cards; raw cards)",
    noValueCoverage: "Not enough price coverage yet to estimate a full-set value.",
    completionHeading: "Your set completion",
    completionAria: "Set completion: {owned} of {total} cards",
    owned: "owned",
    missing: "missing",
    complete: "{percent}% complete",
    missingValuePre: " · missing cards ≈ ",
    missingValueNote: " ({priced}/{missing} priced, cheapest variants)",
    checklistNote:
      "Standard checklist: a card counts as owned when you have at least one copy of any variant. Variant-level checklists are estimated from available market data and may be incomplete.",
    signInPre:
      " to see your completion progress for this set and the estimated cost of your missing cards.",
    filtersAria: "Card list filters",
    filterAll: "All",
    filterOwned: "Owned",
    filterMissing: "Missing",
    filterAnyRarity: "Any rarity",
    filterRarePlus: "Rare+",
    filterAnyType: "Any type",
    rarityCommon: "Common",
    rarityUncommon: "Uncommon",
    typePokemon: "Pokémon",
    typeTrainer: "Trainer",
    typeEnergy: "Energy",
    showingCount: "Showing {visible} of {total} cards",
    badgeOwned: "Owned",
    badgeMissing: "Missing",
    setCardList: "{name} card list",
    setCardListDescription: "All cards in the Pokémon TCG set {name}.",
    mostValuableHeading: "Most valuable cards in {name}",
  },

  priceMovers: {
    metaTitle: "Pokémon Card Price Movers — Biggest Gainers & Decliners | Pokector",
    metaDescription:
      "Which Pokémon cards gained or lost the most market value in the last 7 and 30 days — based on real price observations recorded by Pokector.",
    breadcrumb: "Price movers",
    heading: "Price movers",
    intro:
      "The biggest raw-card market moves across the whole catalog. Changes are computed only from real recorded price observations — a card needs at least a week (or a month) of history to appear here.",
    emptyTitle: "Price movers are warming up",
    emptyBodyPre:
      "Movers appear once cards have at least 7 days of real recorded price history. Pokector records observations daily for the entire catalog — you don't need to add anything. Meanwhile, ",
    emptyBodyLink: "browse the catalog",
    emptyBodyPost: " for current prices.",
    gainers7: "7-day gainers",
    decliners7: "7-day decliners",
    gainers30: "30-day gainers",
    decliners30: "30-day decliners",
    sectionEmpty: "No qualifying moves in this window yet — more tracked history is needed.",
  },

  pokedex: {
    metaTitle: "Pokédex — Every Pokémon by Card Count & Average Price | Pokector",
    metaDescription:
      "Browse the full National Pokédex: each Pokémon with its number, how many cards exist, and the average market price — from Bulbasaur to the newest generation.",
    breadcrumb: "Pokédex",
    heading: "Pokédex",
    intro:
      "Every Pokémon in the National Pokédex with its card count and average card market price. Tap a Pokémon to see its cards.",
    generationLabel: "Generation {n}",
    colNumber: "No.",
    colCards: "Cards",
    colAvgPrice: "Avg. price",
    cardsCount: "{count} cards",
    noCards: "No cards yet",
    filterAll: "All",
    filterFavorites: "Favorites",
    genShort: "Gen {n}",
    ownedCards: "{owned}/{total} cards",
    addFavorite: "Add to favorites",
    removeFavorite: "Remove from favorites",
    favoritesEmpty: "No favorites yet — tap the ★ on a Pokémon to add it.",
  },

  compare: {
    metaTitle: "Compare Pokémon Card Prices | Pokector",
    metaDescription: "Overlay the market price history of up to three Pokémon cards side by side.",
    breadcrumb: "Compare",
    heading: "Compare cards",
    intro: "Overlay the price history of up to 3 cards to see how they move against each other.",
    addLabel: "Add a card",
    addPlaceholder: "Search by name or number…",
    addAnother: "Add another card",
    remove: "Remove {name}",
    full: "You can compare up to 3 cards. Remove one to add another.",
    empty: "Add cards to compare their price history.",
    chartEmpty: "No recorded price history yet for the selected cards.",
    rangeAria: "Chart time range",
    showTable: "Show data table",
    hideTable: "Hide data table",
    dateColumn: "Date",
    searchNoResults: "No matching cards.",
    compareCta: "Compare",
  },

  auth: {
    verifyHuman: "Please complete the human verification below.",
    tooManyAttempts: "Too many attempts. Please wait a minute and try again.",
    // Sign in
    signInMetaTitle: "Sign in — Pokector",
    signInHeading: "Sign in",
    signInInvalid: "Invalid e-mail or password.",
    emailLabel: "E-mail",
    passwordLabel: "Password",
    signingIn: "Signing in…",
    signInButton: "Sign in",
    forgotPassword: "Forgot your password?",
    newToPokector: "New to Pokector? ",
    createAnAccount: "Create an account",
    // Register
    registerMetaTitle: "Create account — Pokector",
    registerHeading: "Create your account",
    registerSubtitle: "Track your collection, portfolio value, and set completion — free.",
    passwordsNoMatch: "Passwords do not match.",
    passwordTooShort: "Password must be at least 8 characters long.",
    registerFailed: "Registration failed. Please try again.",
    displayNameLabel: "Display name",
    passwordHint8: "At least 8 characters.",
    confirmPasswordLabel: "Confirm password",
    creatingAccount: "Creating account…",
    createAccountButton: "Create account",
    alreadyHaveAccount: "Already have an account? ",
    byCreatingPre: "By creating an account you agree to the ",
    termsOfService: "Terms of Service",
    and: " and ",
    privacyPolicy: "Privacy Policy",
    // Forgot password
    forgotMetaTitle: "Reset password — Pokector",
    forgotHeading: "Reset your password",
    forgotTooMany: "Too many attempts. Please wait a few minutes and try again.",
    forgotError: "Could not process the request. Please try again.",
    emailUnavailablePre:
      "Automated password-reset e-mails are currently unavailable. Please contact support at ",
    emailUnavailablePost: " to regain access to your account.",
    backToSignIn: "Back to sign in",
    resetSent:
      "If an account exists for that e-mail address, a reset link is on its way. Check your inbox.",
    sending: "Sending…",
    sendResetLink: "Send reset link",
    // Reset password
    resetMetaTitle: "Choose a new password — Pokector",
    resetHeading: "Choose a new password",
    resetMissingToken:
      "This reset link is missing its token. Please use the link from your e-mail, or request a new one.",
    requestNewLink: "Request a new link",
    resetInvalid: "This reset link is invalid or has expired. Please request a new one.",
    newPasswordLabel: "New password",
    newPasswordHint: "At least 8 characters. All other sessions will be signed out.",
    confirmNewPasswordLabel: "Confirm new password",
    saving: "Saving…",
    setNewPassword: "Set new password",
  },

  notFound: {
    metaTitle: "Page not found | Pokector",
    heading: "Page not found",
    body: "The page you are looking for does not exist or may have moved.",
    backHome: "Back to homepage",
  },
} as const;

/** Recursively map every string leaf to `string` — the shape other locales satisfy. */
export type DeepString<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepString<T[K]>;
};

export type Dict = DeepString<typeof en>;

export default en;
