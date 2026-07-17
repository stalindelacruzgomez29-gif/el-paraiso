/* Datos de la carta de El Paraíso — los usan la carta y el editor.
   Es la versión POR DEFECTO; lo que Stalin edite se guarda en la nube y manda sobre esto. */
window.CARTA_DEFECTO = {
  nombre: "El Paraíso",
  desde: "1968",
  lema: "Fusión Caribeña & Mediterránea",
  contacto: { tel: "689 980 202", horario: "08:00 – 23:00", web: "elparaiso.wegic.net" },
  promos: [],   // las promociones se crean desde el editor y se guardan en la nube
  secciones: [
    { titulo: "Selección Premium", en: "Chef's Premium Selection", estilo: "premium", nota: "✦ Recomendación del Chef ✦", platos: [
      { nom: "Chuletón Angus Reserva a la Parrilla", en: "Grilled Angus reserve T-bone", desc: "Corte seleccionado de ternera Angus, jugoso y lleno de sabor, sellado a la parrilla.", precio: "31,90 €" },
      { nom: "Pulpo a la Brasa Estilo Tradicional", en: "Traditional char-grilled octopus", desc: "Pulpo tierno terminado a la brasa con aceite de oliva virgen y un toque de pimentón ahumado.", precio: "23,90 €" },
      { nom: "Paella Real de Bogavante Fresco", en: "Fresh lobster paella", desc: "Arroz seleccionado cocinado lentamente con bogavante fresco y marisco premium.", precio: "2p 64,90 · 3p 88,90 · 4p 109,90 €" },
      { nom: "Dorada Rellena de Gambas", en: "Sea bream stuffed with prawns", desc: "Sabor auténtico del Mediterráneo, a la plancha o frita. Elige tu estilo favorito.", precio: "28,90 €" }
    ]},
    { titulo: "Desayunos", en: "Breakfast · served with coffee & fresh juice", platos: [
      { nom: "Yonge de Tortilla", en: "", desc: "Pan yonge artesanal con tortilla española. Incluye café y zumo natural.", precio: "5,50 €" },
      { nom: "Yonge de Jamón Serrano y Queso", en: "", desc: "Jamón serrano y queso fundido. Incluye café y zumo natural.", precio: "6,50 €" },
      { nom: "Tostadas de Jamón Serrano con Tomate", en: "", desc: "Tomate natural rallado y jamón serrano, con aceitunas verdes.", precio: "5,90 €" },
      { nom: "Tostadas de Aguacate", en: "", desc: "Aguacate fresco, tomate cherry, rúcula y AOVE. Incluye café y zumo.", precio: "6,20 €" },
      { nom: "Tostada de Aguacate con Queso", en: "", desc: "Aguacate, queso fresco, tomate y un toque de limón. Incluye café y zumo.", precio: "6,80 €" },
      { nom: "Oferta Desayuno Completo", en: "", desc: "Tostadas, tortilla, café, zumo natural y aceitunas.", precio: "8,90 €" }
    ]},
    { titulo: "Entrantes", en: "Starters", platos: [
      { nom: "Croquetas Caseras (6)", en: "Homemade croquettes", desc: "Cremosas croquetas de jamón ibérico.", precio: "8,50 €" },
      { nom: "Nachos Paraíso", en: "Nachos with cheese & guacamole", desc: "Queso fundido, guacamole, pico de gallo y crema agria.", precio: "9,90 €" },
      { nom: "Alitas Picantes", en: "Spicy chicken wings", desc: "Con salsa picante y dip de queso azul.", precio: "9,00 €" },
      { nom: "Alitas BBQ", en: "BBQ chicken wings", desc: "Salsa barbacoa casera y sésamo.", precio: "9,00 €" },
      { nom: "Patatas Bravas", en: "Potatoes with spicy sauce", desc: "Patatas crujientes con salsa brava y alioli.", precio: "8,00 €" },
      { nom: "Patatas Fritas", en: "French fries", desc: "", precio: "4,80 €" },
      { nom: "Tostones Crujientes", en: "Crispy fried plantains", desc: "", precio: "4,80 €" },
      { nom: "Arroz Blanco", en: "White rice", desc: "", precio: "4,39 €" }
    ]},
    { titulo: "Ensaladas", en: "Salads", platos: [
      { nom: "Ensalada Paraíso", en: "Paraíso salad", desc: "Lechugas, tomate, aguacate, gambas, queso y vinagreta balsámica.", precio: "13,90 €" },
      { nom: "Ensalada César", en: "Caesar salad", desc: "Romana, pollo a la parrilla, parmesano, crutones y salsa César.", precio: "13,90 €" },
      { nom: "Ensalada de Atún", en: "Tuna salad", desc: "", precio: "8,90 €" }
    ]},
    { titulo: "Paellas y Arroces", en: "Paellas & Rice · minimum 2 people", platos: [
      { nom: "Paella Imperial de Mariscos", en: "Seafood paella", desc: "Gambas, mejillones, calamares y alioli.", precio: "2p 48,90 · 3p 68,90 · 4p 78,90 €" },
      { nom: "Arroz Negro Selección del Chef", en: "Squid ink rice", desc: "Tinta de calamar, marisco fresco y alioli.", precio: "2p 47,90 · 3p 68,90 · 4p 83,90 €" },
      { nom: "Paella Mixta", en: "Mixed paella", desc: "Carne y marisco sobre arroz de la casa.", precio: "2p 46 · 3p 64 · 4p 74 €" },
      { nom: "Paella Real de Bogavante Fresco", en: "Fresh lobster paella", desc: "Ver Selección Premium.", precio: "2p 64,90 · 3p 88,90 · 4p 109,90 €" }
    ]},
    { titulo: "Carnes a la Parrilla", en: "Grilled Meats", platos: [
      { nom: "Chuletón Angus Reserva", en: "Angus reserve T-bone", desc: "Recomendación del Chef, sellado a la parrilla.", precio: "31,90 €" },
      { nom: "Entrecot de Angus a la Parrilla", en: "Angus ribeye", desc: "Con tostones, ensalada y aguacate.", precio: "25,90 €" },
      { nom: "Chuletas de Cordero a la Parrilla", en: "Grilled lamb chops", desc: "Con romero, ajo y patatas asadas.", precio: "17,90 €" },
      { nom: "Churrasco a la Parrilla", en: "Grilled churrasco", desc: "Con tostones, ensalada y aguacate.", precio: "14,90 €" },
      { nom: "Chuletas de Aguja de Cerdo", en: "Pork shoulder chops", desc: "", precio: "13,90 €" },
      { nom: "Pechuga Empanada", en: "Breaded chicken breast", desc: "", precio: "13,90 €" },
      { nom: "Pechuga a la Plancha", en: "Grilled chicken breast", desc: "Con arroz blanco y ensalada tropical.", precio: "13,90 €" },
      { nom: "Pollo al Curry", en: "Chicken curry", desc: "Curry con leche de coco, arroz basmati, ensalada y aguacate.", precio: "14,90 €" }
    ]},
    { titulo: "Pescados y Mariscos", en: "Fish & Seafood", platos: [
      { nom: "Pulpo a la Parrilla", en: "Grilled octopus", desc: "Con pimentón, aceite de oliva y patatas.", precio: "22,00 €" },
      { nom: "Dorada a la Plancha", en: "Grilled sea bream", desc: "Con limón y aceite de oliva virgen.", precio: "19,00 €" },
      { nom: "Salmón a la Plancha", en: "Grilled salmon", desc: "Con salsa de eneldo, ensalada y aguacate.", precio: "17,90 €" },
      { nom: "Pescado Relleno de Gambas", en: "Fish stuffed with prawns", desc: "Pescado del día al horno con verduras mediterráneas.", precio: "27,00 €" },
      { nom: "Mejillones al Vapor", en: "Steamed mussels", desc: "", precio: "14,90 €" }
    ]},
    { titulo: "Especialidades Caribeñas", en: "Caribbean Specialties", estilo: "premium", nota: "✦ Sabor del Caribe ✦", platos: [
      { nom: "Picalonga Caribeña", en: "Mixed Caribbean platter", desc: "Picada mixta con costillas, chuletas, chorizo, morcilla, tostones y yuca.", precio: "2p 25 · 4p 50 €" },
      { nom: "Picapollo Caribeño", en: "Caribbean fried chicken", desc: "Pollo frito caribeño con tostones, yuca y ensalada tropical.", precio: "2p 20 · 4p 30 · 6p 60 €" },
      { nom: "Mofongo Tradicional", en: "Traditional mofongo", desc: "Plátano verde majado con chicharrón, ajo y caldo, servido con carne.", precio: "18,00 €" },
      { nom: "Wok de Gambas con Arroz", en: "Prawn wok with rice", desc: "Gambas salteadas al wok con verduras frescas y arroz blanco.", precio: "16,00 €" }
    ]},
    { titulo: "Hamburguesas", en: "Burgers", platos: [
      { nom: "Hamburguesa Sencilla", en: "Classic burger", desc: "", precio: "10,50 €" },
      { nom: "Hamburguesa Triple Queso", en: "Triple cheese burger", desc: "", precio: "12,90 €" },
      { nom: "Hamburguesa Paraíso XL", en: "Paraíso XL burger", desc: "", precio: "14,90 €" }
    ]},
    { titulo: "Pizzas", en: "Pizzas", platos: [
      { nom: "Pizza Margarita", en: "Margherita", desc: "", precio: "11,90 €" },
      { nom: "Pizza Paraíso", en: "Paraíso pizza", desc: "", precio: "13,90 €" }
    ]},
    { titulo: "Menú Mini Paraíso", en: "Kids Menu", estilo: "kids", platos: [
      { nom: "A elegir uno", en: "", desc: "Espaguetis boloñesa · Espaguetis carbonara · Hamburguesa sencilla · Nuggets de pollo. Incluye patatas fritas y zumo.", precio: "8,90 €" }
    ]},
    { titulo: "Postres", en: "Desserts", platos: [
      { nom: "Tarta de Zanahoria", en: "Carrot cake", desc: "", precio: "2,70 €" },
      { nom: "Tarta de Chocolate", en: "Chocolate cake", desc: "", precio: "3,00 €" },
      { nom: "Tarta de Coco", en: "Coconut cake", desc: "", precio: "3,00 €" }
    ]}
  ]
};
