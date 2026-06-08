#!/usr/bin/env python3

import json
import re
import sys
from collections import Counter
from pathlib import Path

from pypdf import PdfReader


FRONT_FIXES = {
    "VVasicek's modelasicek's model": "Vasicek's model",
    "nn": "nth order partial autocorrelation coefficient",
    "VValue Chainalue Chain": "Value Chain",
    "WWashington Consensusashington Consensus": "Washington Consensus",
    "TTrue Alpharue Alpha": "True Alpha",
    "TTransitional Alpharansitional Alpha": "Transitional Alpha",
    "YYield enhancement structured productsield enhancement structured products": "Yield enhancement structured products",
    "VValuesalues": "Values",
    "TTrustrust": "Trust",
}

BASELINE_MODULES = [
    (1, 41, "Universal Investment Considerations"),
    (42, 87, "Methods and Models"),
    (88, 118, "Asset Allocation"),
    (119, 195, "Institutional Asset Owners"),
    (196, 204, "Risk and Risk Management"),
    (205, 228, "Accessing Alternative Investments"),
    (229, 243, "Risk and Risk Management"),
    (244, 275, "Methods and Models"),
    (276, 352, "Accessing Alternative Investments"),
    (353, 444, "Due Diligence & Selecting Managers"),
    (445, 547, "Volatility and Complex Strategies"),
    (548, 558, "Universal Investment Considerations"),
    (559, 573, "Methods and Models"),
    (574, 582, "Due Diligence & Selecting Managers"),
    (583, 595, "CAIA Ethical Principles"),
    (596, 605, "Asset Allocation"),
    (606, 622, "Emerging Topics"),
]

MODULE_KEYWORDS = {
    "Emerging Topics": [
        "bitcoin",
        "crypto",
        "cryptocurrency",
        "blockchain",
        "token",
        "defi",
        "web 3",
        "web3",
        "ico",
        "digital asset",
        "mining",
        "on-chain",
        "stablecoin",
        "nft",
        "wallet",
        "airdrop",
        "hash rate",
        "circulating supply",
        "whale",
        "kill zone",
        "tokenomics",
        "total supply",
        "fully diluted value",
        "token generation event",
        "cliff",
    ],
    "CAIA Ethical Principles": [
        "ethic",
        "fiduciary",
        "professionalism",
        "misconduct",
        "fraud",
        "front running",
        "insider trading",
        "anti-fraud",
        "personal account dealing",
        "pre-clearance",
        "covered securities",
        "access person",
        "code of ethics",
        "trust",
        "values",
        "loyalty",
        "prudence",
        "care",
        "integrity",
        "conflict of interest",
        "moral courage",
        "accountability",
        "fairness",
        "confidentiality",
        "objectivity",
        "impartiality",
        "duty of care",
    ],
    "Institutional Asset Owners": [
        "family office",
        "endowment",
        "foundation",
        "pension",
        "defined benefit",
        "defined contribution",
        "sovereign wealth",
        "asset owner",
        "investment policy statement",
        "grant",
        "spending rate",
        "retirement",
        "liability-driven investing",
        "target-date fund",
        "intergenerational equity",
        "surplus risk",
        "surplus volatility",
        "public pension",
        "retirement accounts",
        "annuity",
        "accumulated benefit obligation",
        "projected benefit obligation",
        "cost-of-living adjustment",
        "matching contribution",
        "mortality tables",
        "total return investor",
        "outsourced cio",
        "ocio",
    ],
    "Asset Allocation": [
        "asset allocation",
        "rebalancing",
        "mvo",
        "mean-variance",
        "core-satellite",
        "risk parity",
        "minimum volatility portfolio",
        "benchmarking",
        "attribution",
        "active management",
        "total return approach",
        "total portfolio approach",
        "risk budgeting",
        "betting against beta",
        "volatility anomaly",
        "objective",
        "constraint",
        "overlay approach",
        "reference portfolio",
        "constant mix",
        "constant proportion portfolio insurance",
        "cppi",
        "option-based portfolio insurance",
        "buy and hold",
        "contrarian strategy",
        "momentum strategy",
        "multiplier",
        "cushion",
        "floor",
        "gap risk",
        "absorption risk",
        "mix approach",
        "drifting asset allocation",
        "balancing portfolios",
        "core portfolio",
        "satellite portfolio",
    ],
    "Risk and Risk Management": [
        "risk management",
        "risk measurement",
        "value at risk",
        "var",
        "liquidity risk",
        "funding liquidity",
        "market liquidity",
        "hedging portfolio",
        "hedging portfolios",
        "liquidity penalty",
        "exception report",
        "risk manager",
        "credit risk",
        "credit events",
        "hedging bucket",
        "stress test",
        "sequence of returns risk",
        "risk control",
        "drawdown",
        "risk bucket",
        "personal risk",
        "operational risk",
        "investment process risk",
        "counterparty risk",
        "settlement risk",
        "circuit breaker",
    ],
    "Methods and Models": [
        "theorem",
        "principal component",
        "pca",
        "eigenvalue",
        "factor analysis",
        "regression",
        "partial autocorrelation",
        "vasicek",
        "cox, ingersoll, and ross",
        "cir model",
        "ho and lee",
        "black-derman-toy",
        "heston",
        "bates",
        "stochastic discount",
        "expected utility",
        "utility function",
        "efficient frontier",
        "equilibrium",
        "arbitrage-free",
        "q-measure",
        "p-measure",
        "kmv",
        "z-score",
        "adaptive markets hypothesis",
        "volatility clustering",
        "time-varying volatility",
        "backward induction",
        "distance to default",
        "default intensity",
        "credit score",
        "robust minus weak",
        "conservative minus aggressive",
        "momentum crash",
        "resampling returns",
        "shrinkage",
        "signal-to-noise ratio",
        "prospect theory",
        "principal component analysis",
        "multiple regression",
        "stepwise regression",
        "overfitted",
        "pure arbitrage",
        "risk arbitrage",
        "transition matrix",
        "panel data",
        "exogenous",
        "endogenous",
        "normative model",
        "positive model",
        "theoretical models",
        "empirical models",
        "factor loadings",
        "co-integration",
        "stationary",
        "joint hypothesis",
    ],
    "Accessing Alternative Investments": [
        "private equity",
        "hedge fund",
        "hedge funds",
        "real estate",
        "real asset",
        "real assets",
        "private credit",
        "distressed debt",
        "commodity",
        "commodities",
        "infrastructure",
        "listed asset",
        "listed assets",
        "managed futures",
        "j-curve",
        "waterfall",
        "moic",
        "irr",
        "unitranche",
        "buyout",
        "venture capital",
        "fund of funds",
        "commodity index",
        "etn",
        "participation note",
        "futures curve",
        "roll procedure",
        "roll yield",
        "collateral yield",
        "spot yield",
        "convenience yield",
        "directional strategies",
        "global macro",
        "merger arbitrage",
        "convertible arbitrage",
        "event-driven",
        "value-based index",
        "quantity-based index",
        "excess return index",
        "cap rate",
        "reoc",
        "reit",
        "hedonic pricing",
        "gp-led secondary",
        "continuation fund",
        "fund recaps",
        "nav lending",
        "inaccessible risk premium",
        "alternative beta",
        "alternative betas",
        "calendar spread",
        "weather derivative",
        "crack spread",
        "crush spreads",
        "beta neutral",
        "sector neutral",
        "open-end real estate funds",
        "vintage year diversification",
        "prepaid forward contracts",
    ],
    "Due Diligence & Selecting Managers": [
        "due diligence",
        "operational due diligence",
        "investment process",
        "fund capacity",
        "custody",
        "position-level transparency",
        "mark to model",
        "level 1 assets",
        "level 2 assets",
        "level 3 assets",
        "asset verification",
        "background investigation",
        "administrator",
        "cutting the nav",
        "net asset value",
        "quantitative due diligence",
        "qualitative due diligence",
        "emerging manager",
        "trade blotter",
        "best execution",
        "trade execution",
        "structural review",
        "notice period",
        "gate provision",
        "side pocket",
        "lockup",
        "redemption",
        "style drift",
        "expert networks",
        "reference checks",
        "onsite visit",
        "service providers",
        "trade allocation",
        "pro rata allocation",
        "restricted list",
        "blackout periods",
        "hardship exemption procedure",
        "fund governance",
        "board of directors",
        "qualified majority",
        "reactive deal sourcing",
        "management team",
        "deal sourcing",
    ],
    "Volatility and Complex Strategies": [
        "volatility derivative",
        "volatility risk",
        "volatility diffusion",
        "volatility jump",
        "implied volatility",
        "regime change",
        "structured product",
        "barrier note",
        "dynamic hedging",
        "static hedge",
        "partial differential equation",
        "payoff diagram",
        "volatility surface",
        "yield enhancement structured products",
        "principal protected",
        "swaption",
        "delta hedge",
        "vega",
        "quanto option",
        "asian option",
        "barrier option",
        "knock-in",
        "knock-out",
        "spread option",
        "look-back option",
        "eusipa",
        "long volatility",
        "short volatility",
        "volatility carry",
        "variance swap",
        "exotic option",
        "equity-linked structured product",
        "wrapper",
        "principal-protected",
        "cash-and-call strategy",
        "participation structured products",
        "capital protection structured products",
        "discount certificate",
        "leveraged certificate",
        "iron condor",
        "correlation swap",
        "complexity risk premium",
    ],
    "Universal Investment Considerations": [
        "sustainability",
        "esg",
        "globalization",
        "investment adviser",
        "aifmd",
        "ucits",
        "blue sky",
        "washington consensus",
        "disclosure",
        "greenwashing",
        "pri",
        "gri",
        "sasb",
        "competent authority",
        "passport",
        "securities and futures",
        "asset stripping",
        "geopolitical",
        "social-license",
        "stakeholder",
        "value chain",
        "market frictions",
        "tax location",
        "proxy voting",
        "negative or exclusionary screening",
        "sin stocks",
        "impact investing",
        "tragedy of the commons",
        "cap and trade",
        "new money",
        "old money",
        "concentrated wealth",
        "tax efficiency",
        "capital gains",
        "lifestyle assets",
        "dynastic wealth",
        "financial capital",
        "human capital",
        "balance of payments",
        "current account deficit",
        "capital account surplus",
        "sterilization",
        "reserve adequacy",
        "stabilization fund",
        "savings funds",
        "pension reserve funds",
        "reserve investment funds",
        "development funds",
        "dutch disease",
        "capital allocation",
        "stewardship",
        "triple bottom line",
        "social license compact",
        "professional industry",
        "impact first",
        "finance first",
        "impact alpha",
        "stranded assets",
        "investment ecosystem",
        "variable capital company",
        "australian securities and investments commission",
        "alternative investment funds regulations",
        "chief compliance officer",
        "sweep exams",
        "cause exams",
        "qualified purchaser",
        "accredited investor",
    ],
}


def baseline_module(card_number):
    for start, end, module_name in BASELINE_MODULES:
        if start <= card_number <= end:
            return module_name
    return "Universal Investment Considerations"


def has_phrase(haystack, needle):
    pattern = r"(?<![a-z0-9])" + re.escape(needle) + r"(?![a-z0-9])"
    return re.search(pattern, haystack) is not None


def dedupe_front(raw_front):
    if raw_front in FRONT_FIXES:
        return FRONT_FIXES[raw_front]

    for index in range(2, len(raw_front) // 2 + 1):
        prefix = raw_front[:index]
        if raw_front.startswith(prefix + prefix):
            return prefix

    return raw_front


def extract_page_tokens(page):
    tokens = []

    def visitor(text, _cm, _tm, _font_dict, _font_size):
        value = text.strip()
        if value:
            tokens.append(value)

    page.extract_text(visitor_text=visitor)
    return tokens


def extract_cards(pdf_path):
    reader = PdfReader(pdf_path)
    tokens = []
    for page in reader.pages:
        tokens.extend(extract_page_tokens(page))

    cards = []
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token.isdigit() and index + 1 < len(tokens):
            card_number = int(token)
            if 1 <= card_number <= 622:
                raw_front = tokens[index + 1]
                front = dedupe_front(raw_front)
                answer_parts = []
                cursor = index + 2
                while cursor < len(tokens):
                    next_token = tokens[cursor]
                    if next_token.isdigit() and 1 <= int(next_token) <= 622:
                        break
                    answer_parts.append(next_token)
                    cursor += 1

                cards.append(
                    {
                        "number": card_number,
                        "raw_front": raw_front,
                        "front": front,
                        "back": " ".join(answer_parts).strip(),
                    }
                )
                index = cursor
                continue
        index += 1

    return cards


def classify_module(card):
    haystack = f"{card['front']} {card['back']}".lower()
    front = card["front"].lower()
    scores = Counter()
    baseline = baseline_module(card["number"])
    scores[baseline] += 1

    for module_name, keywords in MODULE_KEYWORDS.items():
        for keyword in keywords:
            if has_phrase(haystack, keyword):
                scores[module_name] += 3 if has_phrase(front, keyword) else 2

    top_matches = scores.most_common(2)
    chosen_module, chosen_score = top_matches[0]
    second_score = top_matches[1][1] if len(top_matches) > 1 else 0

    return {
        "curriculum_module": chosen_module,
        "uncertain": chosen_score == second_score,
        "classification_method": "keyword" if chosen_score > 1 else "baseline",
    }


def build_cards(pdf_path, source_label):
    parsed_cards = extract_cards(pdf_path)
    cards = []

    for card in parsed_cards:
        classification = classify_module(card)
        cards.append(
            {
                "id": f"caia_l2_{card['number']:03d}",
                "module": "caia",
                "topic": classification["curriculum_module"],
                "subtopic": card["front"],
                "level": "L2",
                "front": card["front"],
                "back": card["back"],
                "curriculum_module": classification["curriculum_module"],
                "uncertain": classification["uncertain"],
                "classification_method": classification["classification_method"],
                "source": source_label,
                "source_number": card["number"],
            }
        )

    return cards


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: import_caia_level2_pdf.py <input.pdf> [output.json]")

    input_path = Path(sys.argv[1]).expanduser().resolve()
    output_path = (
        Path(sys.argv[2]).expanduser().resolve()
        if len(sys.argv) > 2
        else Path(__file__).resolve().parents[1] / "data" / "caia_flashcards.json"
    )

    cards = build_cards(input_path, input_path.name)
    output_path.write_text(json.dumps(cards, indent=2), encoding="utf-8")
    print(f"Wrote {len(cards)} cards to {output_path}")


if __name__ == "__main__":
    main()
