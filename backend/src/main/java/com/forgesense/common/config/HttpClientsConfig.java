package com.forgesense.common.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.time.Duration;

/**
 * HTTP clients shared across the backend (ML service, external calls).
 */
@Configuration
public class HttpClientsConfig {

    @Bean("mlRestClient")
    public RestClient mlRestClient(ForgeSenseProperties props) {
        SimpleClientHttpRequestFactory f = new SimpleClientHttpRequestFactory();
        f.setConnectTimeout(Duration.ofMillis(props.ml().timeoutMs().toMillis()));
        f.setReadTimeout(Duration.ofMillis(props.ml().timeoutMs().toMillis()));
        return RestClient.builder()
                .baseUrl(props.ml().url())
                .requestFactory(f)
                .build();
    }
}