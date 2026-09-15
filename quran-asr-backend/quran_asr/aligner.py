"""Ordered, word-level Levenshtein alignment for constrained Quran recitation."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Alignment:
    expected_index: int | None
    expected: str | None
    recognized: str | None
    status: str  # correct, wrong, missing, extra


def align(expected: list[str], recognized: list[str]) -> list[Alignment]:
    """Return an ordered alignment; substitutions are preferred over delete+insert."""
    rows, cols = len(expected) + 1, len(recognized) + 1
    cost = [[0] * cols for _ in range(rows)]
    for i in range(rows): cost[i][0] = i
    for j in range(cols): cost[0][j] = j
    for i in range(1, rows):
        for j in range(1, cols):
            substitution = cost[i - 1][j - 1] + (expected[i - 1] != recognized[j - 1])
            cost[i][j] = min(substitution, cost[i - 1][j] + 1, cost[i][j - 1] + 1)

    output: list[Alignment] = []
    i, j = len(expected), len(recognized)
    while i or j:
        if i and j and cost[i][j] == cost[i - 1][j - 1] + (expected[i - 1] != recognized[j - 1]):
            output.append(Alignment(i - 1, expected[i - 1], recognized[j - 1], "correct" if expected[i - 1] == recognized[j - 1] else "wrong"))
            i, j = i - 1, j - 1
        elif i and cost[i][j] == cost[i - 1][j] + 1:
            output.append(Alignment(i - 1, expected[i - 1], None, "missing")); i -= 1
        else:
            output.append(Alignment(None, None, recognized[j - 1], "extra")); j -= 1
    return list(reversed(output))
