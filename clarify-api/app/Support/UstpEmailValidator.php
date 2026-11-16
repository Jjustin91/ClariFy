<?php

namespace App\Support;

class UstpEmailValidator
{
    public const ERROR_MESSAGE = 'Only @ustp.edu.ph email addresses can create an account.';

    /**
     * Normalizes an email address by trimming whitespace and lowercasing.
     */
    public static function normalize(?string $raw): string
    {
        return strtolower(trim((string) $raw));
    }

    /**
     * Validates that the email is a well-formed address whose domain is strictly "ustp.edu.ph".
     * Rejects empty local parts ("@ustp.edu.ph"), subdomains ("x@mail.ustp.edu.ph"),
     * and lookalike suffixes ("x@ustp.edu.ph.evil.com").
     */
    public static function isValid(?string $raw): bool
    {
        $normalized = self::normalize($raw);
        if ($normalized === '' || strlen($normalized) > 255) {
            return false;
        }

        if (filter_var($normalized, FILTER_VALIDATE_EMAIL) === false) {
            return false;
        }

        $atPos = strrpos($normalized, '@');
        if ($atPos === false || $atPos === 0) {
            return false;
        }

        $localPart = substr($normalized, 0, $atPos);
        $domainPart = substr($normalized, $atPos + 1);

        if ($localPart === '' || str_contains($localPart, '@')) {
            return false;
        }

        return $domainPart === 'ustp.edu.ph';
    }
}
