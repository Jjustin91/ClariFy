<?php

namespace App\Support;

class PhoneNormalizer
{
    /**
     * Normalizes a Philippine mobile number into canonical E.164 format (+639XXXXXXXXX).
     * Accepts inputs such as "09171234567", "9171234567", "639171234567", "+63 917 123 4567",
     * or "+63-917-123-4567". Returns null if the number is not a valid PH mobile number.
     */
    public static function normalize(?string $raw): ?string
    {
        if ($raw === null) {
            return null;
        }

        $trimmed = trim($raw);
        if ($trimmed === '') {
            return null;
        }

        // Reject strings containing letters or unexpected characters
        if (preg_match('/[^\d\s\-\+\(\)]/', $trimmed)) {
            return null;
        }

        $hasLeadingPlus = str_starts_with($trimmed, '+');
        $digitsOnly = preg_replace('/\D+/', '', $trimmed) ?? '';

        if ($digitsOnly === '') {
            return null;
        }

        if ($hasLeadingPlus) {
            // Must be +639XXXXXXXXX (12 digits starting with 639)
            if (preg_match('/^63(9\d{9})$/', $digitsOnly, $matches)) {
                return '+63' . $matches[1];
            }
            return null;
        }

        // 09XXXXXXXXX (11 digits)
        if (preg_match('/^0(9\d{9})$/', $digitsOnly, $matches)) {
            return '+63' . $matches[1];
        }

        // 639XXXXXXXXX (12 digits)
        if (preg_match('/^63(9\d{9})$/', $digitsOnly, $matches)) {
            return '+63' . $matches[1];
        }

        // 9XXXXXXXXX (10 digits)
        if (preg_match('/^(9\d{9})$/', $digitsOnly, $matches)) {
            return '+63' . $matches[1];
        }

        return null;
    }

    /**
     * Returns true if the input can be normalized to a valid +639XXXXXXXXX PH mobile number.
     */
    public static function isValid(?string $raw): bool
    {
        return self::normalize($raw) !== null;
    }
}
