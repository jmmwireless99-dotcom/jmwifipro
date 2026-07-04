# JM WIFI billing — captive portal + portal proxy
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name jmwifi.pro www.jmwifi.pro 187.77.145.131 _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}

server {
    listen 443 ssl http2 default_server;
    listen [::]:443 ssl http2 default_server;
    server_name jmwifi.pro www.jmwifi.pro 187.77.145.131 _ connectivitycheck.gstatic.com connectivitycheck.android.com captive.apple.com msftconnecttest.com;

    ssl_certificate /etc/letsencrypt/live/jmwifi.pro/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/jmwifi.pro/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}

