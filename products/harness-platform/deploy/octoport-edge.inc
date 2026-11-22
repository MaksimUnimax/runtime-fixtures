# Include inside the existing TLS server for octoport.ru.
location = /about { return 308 /about/$is_args$args; }
location ^~ /about/ {
    root /var/www/octoport-public-info/current;
    index index.html;
    try_files $uri $uri.html $uri/ =404;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header X-Frame-Options DENY always;
    add_header Content-Security-Policy "default-src 'none'; script-src 'self' https://mc.yandex.ru https://yastatic.net; style-src 'self' https://fonts.googleapis.com; img-src 'self' data: https://mc.yandex.ru; connect-src https://octoport.ru/api/session/status https://octoport.ru/api/coins/quote https://octoport.ru/api/coins/checkout https://mc.yandex.ru; child-src blob: https://mc.yandex.ru; frame-src blob: https://mc.yandex.ru; font-src 'self' https://fonts.gstatic.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'" always;
}
location ~ ^/(privacy|support|install|seller-analytics)(?:\.html|/)?$ {
    return 308 /about/$1$is_args$args;
}
location = /index.html { return 308 /about/$is_args$args; }
location = /sitemap.xml { return 308 /about/sitemap.xml; }
location = /robots.txt {
    default_type text/plain;
    return 200 "User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /app/\nSitemap: https://octoport.ru/about/sitemap.xml\n";
}
location / {
    proxy_pass https://185.219.43.9;
    proxy_ssl_server_name on;
    proxy_ssl_name harness.185-219-43-9.sslip.io;
    proxy_ssl_verify on;
    proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
    proxy_ssl_verify_depth 4;
    proxy_http_version 1.1;
    proxy_set_header Host octoport.ru;
    proxy_set_header Connection "";
    proxy_read_timeout 160s;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $remote_addr;
}
