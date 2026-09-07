/**
 * Blocking the passwords that actually appear in credential-stuffing lists does
 * far more for account safety than demanding a symbol and a digit — the usual
 * complexity rules mostly produce "Password1!", which is itself on this list.
 *
 * Checked case-insensitively. This is a pragmatic top-slice, not a full corpus;
 * swap in zxcvbn or a hashed 100k-entry list if you want deeper coverage.
 */
const COMMON = new Set(
  `123456 password 123456789 12345678 12345 1234567 1234567890 qwerty abc123 111111
   123123 admin letmein welcome monkey login princess qwertyuiop solo passw0rd starwars
   dragon sunshine master shadow ashley bailey superman qazwsx michael football
   password1 password123 iloveyou trustno1 000000 654321 zaq12wsx qwerty123 1q2w3e4r
   1qaz2wsx aa123456 baseball donald whatever freedom hello charlie jordan hunter
   buster soccer harley batman andrew tigger sophie robert thomas jessica
   test testing test123 changeme default guest root user admin123 secret
   samsung google facebook amazon apple microsoft nintendo pokemon starwars1
   qwe123 asdfgh zxcvbnm 123qwe 121212 abcd1234 abcdefg 1234 11111111 99999999
   loveme naruto liverpool arsenal chelsea barcelona manchester realmadrid
   dubai uae emirates abudhabi sharjah burjkhalifa marina jumeirah habibi
   tradewave tradewave1 tradewave123 investment money bitcoin crypto wealth`
    .split(/\s+/)
    .filter(Boolean),
);

export function isCommonPassword(plain: string): boolean {
  return COMMON.has(plain.toLowerCase().trim());
}
