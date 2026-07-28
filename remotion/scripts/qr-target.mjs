/**
 * The one place the QR payload is defined. Both the generator and the
 * verifier import it, so they cannot drift — which is the entire point of
 * verifying at all.
 *
 * utm_source distinguishes video scans from the print artifacts' scans.
 */
export const QR_TARGET = "https://www.roamlyflow.com?utm_source=video";
