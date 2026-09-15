# Certificados de CA

## `supabase-root-2021.crt`

A CA raiz do Supabase, baixada de
`https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`
(a mesma que o painel oferece em **Database Settings → SSL Configuration**).

```
subject = CN=Supabase Root 2021 CA, O=Supabase Inc
issuer  = CN=Supabase Root 2021 CA, O=Supabase Inc   (raiz, auto-assinada)
válido  = 28/abr/2021 até 26/abr/2031
sha256  = 80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:
          82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
```

**Por que está aqui:** o Postgres do Supabase — direto ou pelo pooler —
apresenta um certificado assinado por essa raiz, que **não está no bundle do
Node**. Sem ela, a conexão morre com
`self-signed certificate in certificate chain (SELF_SIGNED_CERT_IN_CHAIN)`.

A saída fácil seria `rejectUnauthorized: false`, e é o que quase todo tutorial
manda fazer. Isso transforma o TLS em teatro: continua criptografado e continua
interceptável, porque nada garante que do outro lado está mesmo o Supabase.
Com a raiz em mãos, a verificação é real.

Não é segredo — é um certificado público, e por isso pode ficar no
repositório. Confira o fingerprint acima se algum dia trocar o arquivo.

**Vence em abril de 2031.** Quando o Supabase publicar a raiz seguinte, troque
o arquivo e confira o novo fingerprint.
