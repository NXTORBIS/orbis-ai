// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/orbis/adblock/orbis_filter_parser.h"

#include <algorithm>

#include "base/strings/string_split.h"
#include "base/strings/string_util.h"

namespace orbis {
namespace {

namespace proto = url_pattern_index::proto;

// The element types an option name maps to. Anything absent is not silently
// ignored — ParseOptions reports it, and the rule is dropped rather than applied
// more broadly than it was written.
struct ElementOption {
  std::string_view name;
  proto::ElementType type;
};

constexpr ElementOption kElementOptions[] = {
    {"script", proto::ELEMENT_TYPE_SCRIPT},
    {"image", proto::ELEMENT_TYPE_IMAGE},
    {"stylesheet", proto::ELEMENT_TYPE_STYLESHEET},
    {"css", proto::ELEMENT_TYPE_STYLESHEET},
    {"object", proto::ELEMENT_TYPE_OBJECT},
    {"xmlhttprequest", proto::ELEMENT_TYPE_XMLHTTPREQUEST},
    {"xhr", proto::ELEMENT_TYPE_XMLHTTPREQUEST},
    {"object-subrequest", proto::ELEMENT_TYPE_OBJECT_SUBREQUEST},
    {"subdocument", proto::ELEMENT_TYPE_SUBDOCUMENT},
    {"frame", proto::ELEMENT_TYPE_SUBDOCUMENT},
    {"ping", proto::ELEMENT_TYPE_PING},
    {"beacon", proto::ELEMENT_TYPE_PING},
    {"media", proto::ELEMENT_TYPE_MEDIA},
    {"font", proto::ELEMENT_TYPE_FONT},
    {"popup", proto::ELEMENT_TYPE_POPUP},
    {"websocket", proto::ELEMENT_TYPE_WEBSOCKET},
    {"webtransport", proto::ELEMENT_TYPE_WEBTRANSPORT},
    {"webrtc", proto::ELEMENT_TYPE_WEBTRANSPORT},
    {"other", proto::ELEMENT_TYPE_OTHER},
};

// Options that change what happens to a response rather than whether the request
// is made. The index cannot express them, so a rule carrying one is reported.
constexpr std::string_view kResponseBehaviourOptions[] = {
    "csp", "redirect", "redirect-rule", "removeparam", "removeheader",
    "replace", "inline-script", "inline-font", "empty", "mp4", "cname",
};

bool IsCommentOrHeader(std::string_view line) {
  if (line.empty() || line[0] == '!') {
    return true;
  }
  if (base::StartsWith(line, "[Adblock",
                       base::CompareCase::INSENSITIVE_ASCII)) {
    return true;
  }
  // A leading '#' is a comment in hosts-style lists but the start of a generic
  // cosmetic rule here (`##.sponsored`). Treating every '#' as a comment threw
  // away every generic cosmetic rule in every list before it was ever read.
  return line[0] == '#' && !base::StartsWith(line, "##") &&
         !base::StartsWith(line, "#@#") && !base::StartsWith(line, "#?#") &&
         !base::StartsWith(line, "#$#");
}

// Finds a cosmetic separator (`##`, `#@#`, `#?#`, `#$#`) outside of a pattern.
// Returns npos when the line is a network rule.
size_t FindCosmeticSeparator(std::string_view line, size_t* separator_length,
                             bool* is_exception) {
  for (size_t i = 0; i + 1 < line.size(); ++i) {
    if (line[i] != '#') {
      continue;
    }
    if (line[i + 1] == '#') {
      *separator_length = 2;
      *is_exception = false;
      return i;
    }
    if (i + 2 < line.size() && line[i + 2] == '#' &&
        (line[i + 1] == '@' || line[i + 1] == '?' || line[i + 1] == '$')) {
      *separator_length = 3;
      *is_exception = line[i + 1] == '@';
      return i;
    }
  }
  return std::string_view::npos;
}

void SplitDomains(std::string_view list, char separator,
                  std::vector<std::string>* included,
                  std::vector<std::string>* excluded) {
  for (std::string_view piece : base::SplitStringPiece(
           list, std::string_view(&separator, 1), base::TRIM_WHITESPACE,
           base::SPLIT_WANT_NONEMPTY)) {
    if (piece[0] == '~') {
      excluded->emplace_back(piece.substr(1));
    } else {
      included->emplace_back(piece);
    }
  }
}

// Applies the `$...` options of a network rule. Returns false when the rule uses
// something the index cannot represent, setting `reason`.
bool ParseOptions(std::string_view options, proto::UrlRule* rule,
                  UnsupportedReason* reason) {
  int element_types = 0;
  bool saw_element_option = false;
  bool saw_document = false;

  for (std::string_view option : base::SplitStringPiece(
           options, ",", base::TRIM_WHITESPACE, base::SPLIT_WANT_NONEMPTY)) {
    const bool negated = option[0] == '~';
    if (negated) {
      option = option.substr(1);
    }

    const size_t equals = option.find('=');
    const std::string_view name = option.substr(0, equals);
    const std::string_view value =
        equals == std::string_view::npos ? std::string_view()
                                         : option.substr(equals + 1);

    if (name == "domain") {
      std::vector<std::string> included;
      std::vector<std::string> excluded;
      SplitDomains(value, '|', &included, &excluded);
      for (const std::string& domain : included) {
        auto* item = rule->add_initiator_domains();
        item->set_domain(domain);
        item->set_exclude(false);
      }
      for (const std::string& domain : excluded) {
        auto* item = rule->add_initiator_domains();
        item->set_domain(domain);
        item->set_exclude(true);
      }
      continue;
    }

    if (name == "third-party" || name == "3p") {
      rule->set_source_type(negated ? proto::SOURCE_TYPE_FIRST_PARTY
                                    : proto::SOURCE_TYPE_THIRD_PARTY);
      continue;
    }
    if (name == "first-party" || name == "1p") {
      rule->set_source_type(negated ? proto::SOURCE_TYPE_THIRD_PARTY
                                    : proto::SOURCE_TYPE_FIRST_PARTY);
      continue;
    }
    if (name == "match-case") {
      rule->set_match_case(!negated);
      continue;
    }
    if (name == "document" || name == "doc") {
      // On an exception this lifts filtering for the whole document, which the
      // index expresses as an activation type rather than an element type.
      saw_document = true;
      continue;
    }
    if (name == "all") {
      element_types |= proto::ELEMENT_TYPE_ALL;
      saw_element_option = true;
      continue;
    }

    bool matched_element = false;
    for (const ElementOption& known : kElementOptions) {
      if (name != known.name) {
        continue;
      }
      matched_element = true;
      saw_element_option = true;
      if (negated) {
        // A negated type starts from "everything" and removes this one.
        if (element_types == 0) {
          element_types = proto::ELEMENT_TYPE_ALL;
        }
        element_types &= ~static_cast<int>(known.type);
      } else {
        element_types |= static_cast<int>(known.type);
      }
      break;
    }
    if (matched_element) {
      continue;
    }

    bool response_behaviour = false;
    for (std::string_view known : kResponseBehaviourOptions) {
      if (name == known) {
        response_behaviour = true;
        break;
      }
    }
    if (response_behaviour) {
      *reason = UnsupportedReason::kResponseBehaviour;
      return false;
    }

    *reason = UnsupportedReason::kUnhandledOption;
    return false;
  }

  if (saw_document && !saw_element_option) {
    rule->set_activation_types(proto::ACTIVATION_TYPE_DOCUMENT);
    rule->set_element_types(proto::ELEMENT_TYPE_UNSPECIFIED);
    return true;
  }
  if (saw_element_option) {
    rule->set_element_types(element_types);
  }
  return true;
}

}  // namespace

ParsedLine ParseFilterLine(std::string_view line) {
  ParsedLine parsed;
  line = base::TrimWhitespaceASCII(line, base::TRIM_ALL);

  if (IsCommentOrHeader(line)) {
    parsed.unsupported = UnsupportedReason::kNotARule;
    return parsed;
  }

  size_t separator_length = 0;
  bool cosmetic_exception = false;
  const size_t cosmetic =
      FindCosmeticSeparator(line, &separator_length, &cosmetic_exception);
  if (cosmetic != std::string_view::npos) {
    CosmeticRule rule;
    rule.is_exception = cosmetic_exception;
    rule.selector = std::string(line.substr(cosmetic + separator_length));
    if (rule.selector.empty()) {
      parsed.unsupported = UnsupportedReason::kNotARule;
      return parsed;
    }
    SplitDomains(line.substr(0, cosmetic), ',', &rule.domains,
                 &rule.excluded_domains);
    parsed.cosmetic = std::move(rule);
    parsed.unsupported = UnsupportedReason::kCosmetic;
    return parsed;
  }

  proto::UrlRule rule;
  rule.set_semantics(proto::RULE_SEMANTICS_BLOCKLIST);
  // A filter with no party option applies to both, which the index spells
  // SOURCE_TYPE_ANY. Left unset it is SOURCE_TYPE_UNSPECIFIED, and the index
  // rejects the rule outright — so every ordinary rule was being dropped.
  rule.set_source_type(proto::SOURCE_TYPE_ANY);

  if (base::StartsWith(line, "@@")) {
    rule.set_semantics(proto::RULE_SEMANTICS_ALLOWLIST);
    line = line.substr(2);
  }

  // Options are whatever follows the last unescaped `$`.
  std::string_view pattern = line;
  const size_t options_at = line.rfind('$');
  if (options_at != std::string_view::npos && options_at > 0 &&
      line[options_at - 1] != '\\') {
    if (!ParseOptions(line.substr(options_at + 1), &rule,
                      &parsed.unsupported)) {
      return parsed;
    }
    pattern = line.substr(0, options_at);
  }

  if (pattern.empty()) {
    parsed.unsupported = UnsupportedReason::kNotARule;
    return parsed;
  }

  // A `/.../` pattern is a regular expression. The index is a substring matcher
  // with wildcards; approximating a regex here would change what the rule blocks.
  if (pattern.size() > 1 && pattern.front() == '/' && pattern.back() == '/') {
    parsed.unsupported = UnsupportedReason::kRegex;
    return parsed;
  }

  proto::AnchorType anchor_left = proto::ANCHOR_TYPE_NONE;
  proto::AnchorType anchor_right = proto::ANCHOR_TYPE_NONE;

  if (base::StartsWith(pattern, "||")) {
    anchor_left = proto::ANCHOR_TYPE_SUBDOMAIN;
    pattern = pattern.substr(2);
  } else if (base::StartsWith(pattern, "|")) {
    anchor_left = proto::ANCHOR_TYPE_BOUNDARY;
    pattern = pattern.substr(1);
  }
  if (base::EndsWith(pattern, "|")) {
    anchor_right = proto::ANCHOR_TYPE_BOUNDARY;
    pattern = pattern.substr(0, pattern.size() - 1);
  }

  if (pattern.empty()) {
    parsed.unsupported = UnsupportedReason::kNotARule;
    return parsed;
  }

  rule.set_anchor_left(anchor_left);
  rule.set_anchor_right(anchor_right);
  rule.set_url_pattern_type(proto::URL_PATTERN_TYPE_SUBSTRING);
  rule.set_url_pattern(std::string(pattern));

  // No element option means the rule applies to every type, which is what the
  // filter syntax means by leaving it out.
  if (!rule.has_element_types() && !rule.has_activation_types()) {
    rule.set_element_types(proto::ELEMENT_TYPE_ALL);
  }

  parsed.rule = std::move(rule);
  return parsed;
}

ParseStats ParseFilterList(std::string_view text,
                           std::vector<proto::UrlRule>* rules,
                           std::vector<CosmeticRule>* cosmetic) {
  ParseStats stats;
  for (std::string_view line :
       base::SplitStringPiece(text, "\n", base::TRIM_WHITESPACE,
                              base::SPLIT_WANT_NONEMPTY)) {
    ParsedLine parsed = ParseFilterLine(line);
    if (parsed.rule) {
      if (rules) {
        rules->push_back(std::move(*parsed.rule));
      }
      ++stats.network_rules;
      continue;
    }
    if (parsed.cosmetic) {
      if (cosmetic) {
        cosmetic->push_back(std::move(*parsed.cosmetic));
      }
      ++stats.cosmetic_rules;
      continue;
    }
    if (parsed.unsupported == UnsupportedReason::kNotARule) {
      ++stats.comments;
    } else {
      ++stats.unsupported;
    }
  }
  return stats;
}

}  // namespace orbis
