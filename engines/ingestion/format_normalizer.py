"""
PrepFreeX Question Text & Layout Normalizer
Ensures questions have properly arranged text, pristine LaTeX formatting,
clean Match-the-List tables, and valid scientific units before pushing to production.
"""

import re
from typing import Any, Tuple, List, Dict

# Match List pattern detector
MATCH_LIST_PATTERN = re.compile(
    r'(?:match\s+list\s+i\s+with\s+list\s+ii|match\s+column\s+i\s+with\s+column\s+ii)',
    re.IGNORECASE
)

# Common unit fixes (converting flat OCR strings to standard LaTeX)
UNIT_REPLACEMENTS = [
    (r'\bms\s*[-–]?\s*1\b', r'\\text{m s}^{-1}'),
    (r'\bms\s*[-–]?\s*2\b', r'\\text{m s}^{-2}'),
    (r'\bms\s*[-–]?\s*3\b', r'\\text{m s}^{-3}'),
    (r'\bkg\s*m\s*[-–]?\s*3\b', r'\\text{kg m}^{-3}'),
    (r'\bkg\s*m\s*[-–]?\s*2\b', r'\\text{kg m}^{-2}'),
    (r'\bkg\s*m\s*[-–]?\s*1\b', r'\\text{kg m}^{-1}'),
    (r'\brad\s*s\s*[-–]?\s*1\b', r'\\text{rad s}^{-1}'),
    (r'\brad\s*s\s*[-–]?\s*2\b', r'\\text{rad s}^{-2}'),
    (r'\bN\s*m\s*[-–]?\s*2\b', r'\\text{N m}^{-2}'),
    (r'\bN\s*m\s*[-–]?\s*1\b', r'\\text{N m}^{-1}'),
    (r'\bkJ\s*mol\s*[-–]?\s*1\b', r'\\text{kJ mol}^{-1}'),
    (r'\bJ\s*mol\s*[-–]?\s*1\b', r'\\text{J mol}^{-1}'),
    (r'\bmol\s*L\s*[-–]?\s*1\b', r'\\text{mol L}^{-1}'),
    (r'\bJ\s*kg\s*[-–]?\s*1\b', r'\\text{J kg}^{-1}'),
    (r'\bN\s*s\b', r'\\text{N s}'),
]

def clean_watermarks_and_cruft(text: str) -> str:
    """Removes website headers, OCR page banners, and coaching watermarks."""
    patterns = [
        r'Open solution',
        r'Keep practising on the ExamGOAL app[\s\S]*?(?=\Z|Q\d+\.)',
        r'Chapter-wise PYQs with solutions[^\n]*',
        r'Google Play[^\n]*',
        r'GET IT ON[^\n]*',
        r'JEE Main \d{4}.*?Page \d+ / \d+',
        r'Solutions:\s*questions\.examside\.com[^\n]*',
        r'Scan the QR code[^\n]*',
        r'ExamGOAL\s+P\s+Y\s+Q\s+P\s+D\s+F',
        r'pdf\.questions\.examgoal\.com',
        r'#MathBoleTohMathonGo',
        r'www\.mathongo\.com',
    ]
    cleaned = text
    for p in patterns:
        cleaned = re.sub(p, '', cleaned, flags=re.IGNORECASE)
    return cleaned.strip()

def format_match_list_tables(stem: str) -> str:
    """
    Detects smushed Match List text (e.g. A. Torque I. Nms) and converts
    into a clean, properly formatted markdown table.
    """
    if not MATCH_LIST_PATTERN.search(stem):
        return stem

    # Look for patterns like:
    # A. <Item1> I. <Item2>
    # B. <Item1> II. <Item2>
    # C. <Item1> III. <Item2>
    # D. <Item1> IV. <Item2>
    row_pattern = re.compile(
        r'([A-D])\.\s*([^\r\n]+?)\s+(I{1,3}|IV|V)\.\s*([^\r\n]+?)(?=(?:\r?\n\s*[A-D]\.|\r?\n\s*Choose|\Z))',
        re.IGNORECASE
    )

    matches = row_pattern.findall(stem)
    if len(matches) >= 3:
        # We found at least 3 matching rows!
        # Extract pre-table stem text (usually "Match List I with List II.")
        header_match = re.split(r'\b[A-D]\.', stem, maxsplit=1)
        header_text = header_match[0].strip() if header_match else "Match List I with List II."
        
        # Clean header text of any smushed "List I List II"
        header_text = re.sub(r'List\s+I\s+List\s+II', '', header_text, flags=re.IGNORECASE).strip()
        if not header_text.endswith("."):
            header_text += "."

        # Build clean markdown table
        table_lines = [
            header_text,
            "",
            "| List I | List II |",
            "| :--- | :--- |"
        ]

        for m_col1, m_item1, m_col2, m_item2 in matches:
            clean_item1 = m_item1.strip()
            clean_item2 = m_item2.strip()
            table_lines.append(f"| **{m_col1.upper()}.** {clean_item1} | **{m_col2.upper()}.** {clean_item2} |")

        table_lines.append("")
        table_lines.append("Choose the correct answer from the options given below :")
        return "\n".join(table_lines)

    return stem

def normalize_latex_and_units(text: str) -> str:
    """Standardizes mathematical units and closes dangling LaTeX delimiters."""
    cleaned = text
    for pat, repl in UNIT_REPLACEMENTS:
        cleaned = re.sub(pat, repl, cleaned)

    # Balance unclosed $ delimiters
    dollar_count = cleaned.count('$')
    if dollar_count % 2 != 0:
        # If odd number of $, append closing $ at the end
        cleaned = cleaned + "$"

    return cleaned

def normalize_question_options(options: Any) -> List[Dict[str, Any]]:
    """Standardizes options into clean list of 4 dicts with keys A, B, C, D."""
    standard_keys = ["A", "B", "C", "D"]
    formatted: List[Dict[str, Any]] = []

    if isinstance(options, list):
        for idx, opt in enumerate(options[:4]):
            key = standard_keys[idx] if idx < len(standard_keys) else str(idx + 1)
            if isinstance(opt, dict):
                raw_text = opt.get("text", "")
                diag_key = opt.get("image_s3_key")
            else:
                raw_text = str(opt)
                diag_key = None

            # Clean and normalize option text
            clean_text = clean_watermarks_and_cruft(raw_text)
            clean_text = normalize_latex_and_units(clean_text)
            formatted.append({
                "key": key,
                "text": clean_text,
                "image_s3_key": diag_key
            })

    # Ensure exactly 4 options
    while len(formatted) < 4:
        key = standard_keys[len(formatted)]
        formatted.append({"key": key, "text": "", "image_s3_key": None})

    return formatted

def format_and_arrange_question(
    stem: str,
    options: Any,
    question_type: str = "SINGLE_CHOICE"
) -> Tuple[str, List[Dict[str, Any]], bool, List[str]]:
    """
    Main format & arrange pipeline.
    Returns (cleaned_stem, formatted_options, is_well_formatted, format_notes).
    """
    notes: List[str] = []

    # 1. Boilerplate cleaning
    c_stem = clean_watermarks_and_cruft(stem)

    # 2. Match list structure arrangement
    c_stem = format_match_list_tables(c_stem)

    # 3. Unit and LaTeX normalization
    c_stem = normalize_latex_and_units(c_stem)

    # 4. Standardize options
    fmt_options = normalize_question_options(options)

    # 5. Format validation checks
    is_valid = True
    if len(c_stem.strip()) < 15:
        notes.append("STEM_TOO_SHORT")
        is_valid = False

    if question_type == "SINGLE_CHOICE":
        valid_opts = [o for o in fmt_options if o["text"].strip()]
        if len(valid_opts) < 4:
            notes.append(f"INSUFFICIENT_VALID_OPTIONS ({len(valid_opts)}/4)")
            is_valid = False

    return c_stem, fmt_options, is_valid, notes
