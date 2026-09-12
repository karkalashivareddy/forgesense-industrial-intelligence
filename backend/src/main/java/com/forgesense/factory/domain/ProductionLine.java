package com.forgesense.factory.domain;

import com.forgesense.common.domain.AbstractEntity;
import jakarta.persistence.Entity;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "production_line", indexes = @Index(columnList = "factory_id"))
@Getter
@Setter
@NoArgsConstructor
public class ProductionLine extends AbstractEntity {

    @ManyToOne(optional = false)
    @JoinColumn(name = "factory_id")
    private Factory factory;

    private String name;
    private String code;
    private int orderIndex;

    public ProductionLine(Factory factory, String name, String code, int orderIndex) {
        this.factory = factory;
        this.name = name;
        this.code = code;
        this.orderIndex = orderIndex;
    }
}