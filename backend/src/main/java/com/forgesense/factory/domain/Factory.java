package com.forgesense.factory.domain;

import com.forgesense.common.domain.AbstractEntity;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "factory")
@Getter
@Setter
@NoArgsConstructor
public class Factory extends AbstractEntity {

    private String name;
    private String code;
    private String location;

    public Factory(String name, String code, String location) {
        this.name = name;
        this.code = code;
        this.location = location;
    }
}